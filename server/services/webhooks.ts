/**
 * Webhook notification service for CallAnalyzer.
 * Sends HTTP POST notifications to external systems (Slack, email, CRMs)
 * when events occur (call completed, failed, low/exceptional scores, coaching created).
 *
 * Webhook configs are stored as JSON in S3 under the `webhooks/` prefix.
 * HMAC-SHA256 signatures are included for payload verification.
 */
import { createHmac } from "crypto";
import { isUrlSafe } from "./url-validator";
import { logger } from "./logger";
import { PerKeyCircuitBreaker, CircuitBreakerOpenError, type CircuitSnapshot } from "./resilience";
import type { ObjectStorageClient } from "../storage";

const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_RETRY_BASE_DELAY_MS = 2_000;

// Per-webhook circuit breaker. Opens after 5 consecutive failures per webhookId
// for 5 minutes, then transitions to half-open for one test call. Keyed on
// webhook config ID so one broken receiver doesn't brownout the rest; one open
// circuit skips both the in-process retries AND the durable-retry enqueue.
const WEBHOOK_BREAKER_THRESHOLD = 5;
const WEBHOOK_BREAKER_RESET_MS = 5 * 60_000;
export const webhookBreaker = new PerKeyCircuitBreaker(
  "webhook",
  WEBHOOK_BREAKER_THRESHOLD,
  WEBHOOK_BREAKER_RESET_MS,
);

/**
 * Thrown by `deliverWebhook` when the receiver returns a non-2xx HTTP status.
 * Carries the numeric status so the circuit-breaker `isFailure` predicate can
 * distinguish client-side errors (4xx) from upstream-unhealthy errors (5xx,
 * 429, network failures). Mirrors `BedrockClientError`'s role in `bedrock.ts`.
 */
export class WebhookHttpError extends Error {
  constructor(public readonly status: number, public readonly statusText: string) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "WebhookHttpError";
  }
}

/**
 * Circuit-breaker failure predicate for webhook delivery.
 *
 * Only network failures, timeouts, 429 (throttling), and 5xx (upstream
 * failure) count toward the open-threshold. A misconfigured webhook URL
 * returning 4xx is a permanent client-side error — tripping the breaker on
 * it doesn't help (retry won't fix it) and it also blocks the durable-retry
 * enqueue, making it harder for the operator to re-send after fixing the
 * config. Mirrors the Bedrock breaker's `isCircuitFailure` contract.
 */
function isWebhookCircuitFailure(err: unknown): boolean {
  if (err instanceof WebhookHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  // Network errors, timeouts, AbortError, SSRF blocks — all count.
  return true;
}

/** Exported for the admin observability endpoint. */
export function getWebhookBreakerSnapshot(): CircuitSnapshot[] {
  return webhookBreaker.snapshot();
}
const WEBHOOK_MAX_RETRIES = 4;

// --- Types ---

export type WebhookEvent =
  | "call.completed"
  | "call.failed"
  | "score.low"
  | "score.exceptional"
  | "coaching.created";

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "call.completed",
  "call.failed",
  "score.low",
  "score.exceptional",
  "coaching.created",
];

/**
 * Optional per-webhook retry policy override. Mission-critical consumers
 * (e.g. a CRM that must not miss `call.completed`) can raise retry counts;
 * low-priority consumers (e.g. Slack) can lower the circuit threshold so
 * flaky receivers trip sooner. All fields are optional — unset values
 * inherit service-wide defaults (4 in-process retries, circuit opens at 5
 * failures for 5 min).
 */
export interface WebhookRetryPolicy {
  maxInProcessRetries?: number;
  circuitThreshold?: number;
  circuitResetMs?: number;
}

export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  retryPolicy?: WebhookRetryPolicy;
  createdBy: string;
  createdAt: string;
}

export type InsertWebhookConfig = Omit<WebhookConfig, "id" | "createdAt">;

// --- S3 client accessor ---

let getS3Client: (() => ObjectStorageClient | undefined) | null = null;
let initialized = false;

// Persistent-retry accessor: when set, a webhook whose in-process retries all
// fail gets enqueued as a `deliver_webhook` job in the durable job queue so it
// survives process restart. When unset (e.g. dev without DATABASE_URL), the
// exhausted delivery stays a logger.error with no durable retry.
type EnqueueWebhookRetry = (payload: {
  webhookId: string;
  event: string;
  body: string;
  previousAttempts: number;
}) => Promise<void> | void;
let enqueueWebhookRetry: EnqueueWebhookRetry | null = null;

/**
 * Initialize the webhook service with an S3 client accessor.
 * Called once at startup from the storage layer.
 */
export function initWebhooks(s3ClientAccessor: () => ObjectStorageClient | undefined): void {
  getS3Client = s3ClientAccessor;
  initialized = true;
  // Reset cache so a re-init (e.g. in tests, or post-startup S3 swap)
  // doesn't serve stale entries from a prior wiring.
  invalidateConfigCache();
}

/**
 * Install the persistent-retry handler. Called from `server/routes.ts` after
 * the JobQueue is created. Optional — without it, webhooks fall back to the
 * prior fire-and-forget behavior after in-process retries.
 */
export function setWebhookRetryEnqueuer(fn: EnqueueWebhookRetry | null): void {
  enqueueWebhookRetry = fn;
}

function requireS3Client(op: string): ObjectStorageClient {
  if (!initialized || !getS3Client) {
    throw new Error(`[Webhooks] S3 client not initialized — call initWebhooks() at startup before ${op}`);
  }
  const client = getS3Client();
  if (!client) {
    throw new Error(`[Webhooks] S3 client unavailable for ${op} — webhook persistence requires S3`);
  }
  return client;
}

// --- Config cache (A5/F09) ---
// Webhook configs are read on every triggerWebhook() call. Cache the list for
// 30s to avoid hammering S3 listAndDownloadJson on every event.
const CONFIG_CACHE_TTL_MS = 30_000;
let configCache: { configs: WebhookConfig[]; expiresAt: number } | null = null;

function invalidateConfigCache(): void {
  configCache = null;
}

// --- Config CRUD (S3-backed) ---

export async function getAllWebhookConfigs(): Promise<WebhookConfig[]> {
  // Serve from 30s TTL cache if fresh
  if (configCache && Date.now() < configCache.expiresAt) {
    return configCache.configs;
  }
  if (!initialized || !getS3Client) {
    // No S3 wired up yet — return empty list rather than throwing on read paths
    // (triggerWebhook is fire-and-forget and shouldn't crash callers).
    return [];
  }
  const client = getS3Client();
  if (!client) return [];
  try {
    const configs = await client.listAndDownloadJson<WebhookConfig>("webhooks/");
    configCache = { configs, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
    return configs;
  } catch (err) {
    logger.warn("Failed to list webhook configs", { error: (err as Error).message });
    return [];
  }
}

export async function getWebhookConfig(id: string): Promise<WebhookConfig | undefined> {
  if (!initialized || !getS3Client) return undefined;
  const client = getS3Client();
  if (!client) return undefined;
  try {
    return await client.downloadJson<WebhookConfig>(`webhooks/${id}.json`);
  } catch {
    return undefined;
  }
}

export async function createWebhookConfig(config: WebhookConfig): Promise<void> {
  const client = requireS3Client("createWebhookConfig");
  await client.uploadJson(`webhooks/${config.id}.json`, config);
  invalidateConfigCache();
}

// `retryPolicy: null` is accepted as an explicit "clear the policy" signal;
// undefined means "leave unchanged". Any other field behaves as normal.
export async function updateWebhookConfig(
  id: string,
  updates: Partial<Omit<WebhookConfig, "retryPolicy">> & { retryPolicy?: WebhookRetryPolicy | null },
): Promise<WebhookConfig | undefined> {
  const existing = await getWebhookConfig(id);
  if (!existing) return undefined;
  // Merge carefully: `retryPolicy: null` means "clear it", explicit
  // undefined means "don't touch", a policy object means "replace wholly".
  const { retryPolicy: incomingPolicy, ...restUpdates } = updates;
  const merged: WebhookConfig = { ...existing, ...restUpdates, id };
  if (incomingPolicy === null) {
    delete merged.retryPolicy;
  } else if (incomingPolicy !== undefined) {
    merged.retryPolicy = incomingPolicy;
  }
  const client = requireS3Client("updateWebhookConfig");
  await client.uploadJson(`webhooks/${id}.json`, merged);
  invalidateConfigCache();
  return merged;
}

export async function deleteWebhookConfig(id: string): Promise<void> {
  const client = requireS3Client("deleteWebhookConfig");
  await client.deleteObject(`webhooks/${id}.json`);
  invalidateConfigCache();
}

// --- Webhook Delivery ---

/**
 * Trigger webhooks for a given event. Non-blocking — logs failures but never throws.
 * Retries once on failure after a 3-second delay.
 */
let warnedUninitialized = false;

export async function triggerWebhook(event: string, payload: any): Promise<void> {
  try {
    if (!initialized) {
      if (!warnedUninitialized) {
        logger.warn("triggerWebhook called before initWebhooks() — webhook delivery is disabled until initWebhooks() runs at startup", { event });
        warnedUninitialized = true;
      }
      return;
    }
    const configs = await getAllWebhookConfigs();
    const matching = configs.filter(c => c.active && c.events.includes(event));

    if (matching.length === 0) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });

    await Promise.allSettled(
      matching.map(config => deliverWithRetry(config, event, body))
    );
  } catch (err) {
    logger.warn("Error triggering webhook event", { event, error: (err as Error).message });
  }
}

async function deliverWithRetry(config: WebhookConfig, event: string, body: string, initialAttempts = 0): Promise<void> {
  // Resolve per-webhook policy overrides with sensible defaults. Unset
  // fields inherit the service-wide defaults declared at module scope.
  const policy = config.retryPolicy ?? {};
  const maxRetries = policy.maxInProcessRetries ?? WEBHOOK_MAX_RETRIES;
  // F-02: always pass the isFailure predicate so 4xx (except 429) do not
  // count toward the breaker's open threshold. Merge with any per-webhook
  // threshold/resetMs overrides. Keeping the breaker in one shape means a
  // future maintainer can't accidentally drop the predicate when adding a
  // new policy field.
  const breakerExecuteOptions: {
    isFailure: (err: unknown) => boolean;
    threshold?: number;
    resetMs?: number;
  } = {
    isFailure: isWebhookCircuitFailure,
    ...(policy.circuitThreshold !== undefined ? { threshold: policy.circuitThreshold } : {}),
    ...(policy.circuitResetMs !== undefined ? { resetMs: policy.circuitResetMs } : {}),
  };

  // Per-webhook circuit breaker check. When open, skip delivery AND skip the
  // durable-retry enqueue — the receiver is known-broken, hammering it with
  // new queue entries is worse than dropping this delivery (the event stays
  // in the stdout log for operator reconstruction).
  if (webhookBreaker.isOpen(config.id)) {
    logger.warn("Webhook circuit open — skipping delivery", {
      url: config.url,
      event,
      webhookId: config.id,
    });
    return;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Wrap the individual delivery in the breaker. Success resets the
      // breaker's counter for this webhookId; failure increments it. After
      // the threshold trips, subsequent `webhookBreaker.isOpen()` checks
      // short-circuit future calls for this key. Per-key thresholds are
      // applied on first creation of the breaker for this webhookId.
      await webhookBreaker.execute(
        config.id,
        () => deliverWebhook(config, event, body),
        breakerExecuteOptions,
      );
      return;
    } catch (err) {
      // F5 (Tier C #10): use typed CircuitBreakerOpenError instead of a
      // second `isOpen()` query. Previously a TOCTTOU window existed between
      // the pre-loop isOpen check and execute, and again between a failure
      // and the post-catch isOpen check. Matching on the error class is
      // race-free — execute() throws this class iff it rejected the call
      // due to open state at the time of the call.
      if (err instanceof CircuitBreakerOpenError) {
        logger.warn("Webhook circuit opened during retry — abandoning", {
          url: config.url,
          event,
          webhookId: config.id,
          attempts: attempt + 1,
        });
        return;
      }
      if (attempt === maxRetries) {
        const totalAttempts = initialAttempts + maxRetries + 1;
        logger.error("All webhook delivery attempts failed", { url: config.url, event, attempts: totalAttempts, error: (err as Error).message });
        // Persistent retry: hand off to the durable job queue if available.
        // The job queue has its own retry/dead-letter semantics (3 attempts),
        // so we get ~5x the delivery durability vs. in-process retry alone,
        // and it survives process restart. Skipped when the breaker is open
        // (checked above) since queueing more work for a known-down receiver
        // is counterproductive.
        if (enqueueWebhookRetry) {
          try {
            await enqueueWebhookRetry({ webhookId: config.id, event, body, previousAttempts: totalAttempts });
            logger.info("Webhook delivery handed off to durable job queue", { url: config.url, event, webhookId: config.id });
          } catch (enqueueErr) {
            logger.error("Failed to enqueue webhook retry", { url: config.url, event, webhookId: config.id, error: (enqueueErr as Error).message });
          }
        }
        return;
      }
      // Exponential backoff: 2s, 4s, 8s, 16s
      const delay = WEBHOOK_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      logger.warn("Webhook delivery attempt failed, retrying", { url: config.url, event, attempt: attempt + 1, retryDelayMs: delay });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Redeliver a webhook payload by ID. Called by the durable job-queue handler
 * when a previously-failed delivery needs another attempt across a restart.
 * Re-reads the live config so a subsequent config update (URL/secret/active
 * flag) is picked up; throws on config missing or inactive so the job's
 * own retry/dead-letter logic handles the terminal outcome.
 */
export async function redeliverWebhook(payload: { webhookId: string; event: string; body: string; previousAttempts?: number }): Promise<void> {
  const config = await getWebhookConfig(payload.webhookId);
  if (!config) {
    throw new Error(`Webhook config not found: ${payload.webhookId}`);
  }
  if (!config.active) {
    throw new Error(`Webhook ${payload.webhookId} is no longer active`);
  }
  if (!config.events.includes(payload.event)) {
    throw new Error(`Webhook ${payload.webhookId} no longer subscribes to event ${payload.event}`);
  }
  await deliverWithRetry(config, payload.event, payload.body, payload.previousAttempts ?? 0);
}

async function deliverWebhook(config: WebhookConfig, event: string, body: string): Promise<void> {
  // Runtime SSRF check — prevents delivery to private/reserved IPs even if the URL
  // was changed directly in storage (bypassing API validation)
  if (!isUrlSafe(config.url)) {
    logger.error("SSRF blocked: refusing to deliver webhook", { url: config.url });
    return;
  }

  // v1 signature (legacy): HMAC-SHA256 over body only.
  // Kept for backward compatibility with existing consumers.
  const signatureV1 = createHmac("sha256", config.secret).update(body).digest("hex");

  // v2 signature (A3/F07): HMAC-SHA256 over `${timestamp}.${body}`.
  // The timestamp prevents replay attacks: receivers should reject deliveries
  // with a timestamp older than ~5 minutes. Dual-emit until all consumers
  // migrate; v1 deprecation timeline to be announced separately.
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signatureV2 = createHmac("sha256", config.secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Signature": signatureV1,
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature-V2": signatureV2,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new WebhookHttpError(response.status, response.statusText);
    }

    logger.info("Webhook delivered", { event, url: config.url, status: response.status });
  } finally {
    clearTimeout(timeout);
  }
}
