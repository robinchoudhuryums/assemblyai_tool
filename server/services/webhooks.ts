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
import type { ObjectStorageClient } from "../storage";

const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_RETRY_BASE_DELAY_MS = 2_000;
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

export interface WebhookConfig {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export type InsertWebhookConfig = Omit<WebhookConfig, "id" | "createdAt">;

// --- S3 client accessor ---

let getS3Client: (() => ObjectStorageClient | undefined) | null = null;
let initialized = false;

/**
 * Initialize the webhook service with an S3 client accessor.
 * Called once at startup from the storage layer.
 */
export function initWebhooks(s3ClientAccessor: () => ObjectStorageClient | undefined): void {
  getS3Client = s3ClientAccessor;
  initialized = true;
  // Invalidate any cached configs from a prior init — important for tests that
  // swap S3 backends between describe blocks, but also a sane invariant: the
  // cache is keyed to the prior backend's view of the world.
  invalidateConfigCache();
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
    console.warn("[Webhooks] Failed to list configs:", (err as Error).message);
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

export async function updateWebhookConfig(id: string, updates: Partial<WebhookConfig>): Promise<WebhookConfig | undefined> {
  const existing = await getWebhookConfig(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, id }; // prevent id change
  const client = requireS3Client("updateWebhookConfig");
  await client.uploadJson(`webhooks/${id}.json`, updated);
  invalidateConfigCache();
  return updated;
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
        console.warn(`[Webhooks] triggerWebhook("${event}") called before initWebhooks() — webhook delivery is disabled until initWebhooks() runs at startup`);
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
    console.warn(`[Webhooks] Error triggering event "${event}":`, (err as Error).message);
  }
}

async function deliverWithRetry(config: WebhookConfig, event: string, body: string): Promise<void> {
  for (let attempt = 0; attempt <= WEBHOOK_MAX_RETRIES; attempt++) {
    try {
      await deliverWebhook(config, event, body);
      return;
    } catch (err) {
      if (attempt === WEBHOOK_MAX_RETRIES) {
        console.error(`[Webhooks] All ${WEBHOOK_MAX_RETRIES + 1} attempts failed for ${config.url} (event: ${event}):`, (err as Error).message);
        return;
      }
      // Exponential backoff: 2s, 4s, 8s, 16s
      const delay = WEBHOOK_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[Webhooks] Attempt ${attempt + 1} failed for ${config.url} (event: ${event}), retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function deliverWebhook(config: WebhookConfig, event: string, body: string): Promise<void> {
  // Runtime SSRF check — prevents delivery to private/reserved IPs even if the URL
  // was changed directly in storage (bypassing API validation)
  if (!isUrlSafe(config.url)) {
    console.error(`[Webhooks] SSRF blocked: refusing to deliver to ${config.url}`);
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
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    console.log(`[Webhooks] Delivered "${event}" to ${config.url} (${response.status})`);
  } finally {
    clearTimeout(timeout);
  }
}
