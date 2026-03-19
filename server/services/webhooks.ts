/**
 * Webhook notification service for CallAnalyzer.
 * Sends HTTP POST notifications to external systems (Slack, email, CRMs)
 * when events occur (call completed, failed, low/exceptional scores, coaching created).
 *
 * Webhook configs are stored as JSON in S3 under the `webhooks/` prefix.
 * HMAC-SHA256 signatures are included for payload verification.
 */
import { createHmac } from "crypto";

const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_RETRY_DELAY_MS = 3_000;

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

let getS3Client: (() => any) | null = null;

/**
 * Initialize the webhook service with an S3 client accessor.
 * Called once at startup from the storage layer.
 */
export function initWebhooks(s3ClientAccessor: () => any): void {
  getS3Client = s3ClientAccessor;
}

// --- Config CRUD (S3-backed) ---

export async function getAllWebhookConfigs(): Promise<WebhookConfig[]> {
  const client = getS3Client?.();
  if (!client) return [];
  try {
    return await (client.listAndDownloadJson as Function).call(client, "webhooks/") as WebhookConfig[];
  } catch (err) {
    console.warn("[Webhooks] Failed to list configs:", (err as Error).message);
    return [];
  }
}

export async function getWebhookConfig(id: string): Promise<WebhookConfig | undefined> {
  const client = getS3Client?.();
  if (!client) return undefined;
  try {
    return await (client.downloadJson as Function).call(client, `webhooks/${id}.json`) as WebhookConfig;
  } catch {
    return undefined;
  }
}

export async function createWebhookConfig(config: WebhookConfig): Promise<void> {
  const client = getS3Client?.();
  if (!client) throw new Error("S3 client not available for webhook storage");
  await client.uploadJson(`webhooks/${config.id}.json`, config);
}

export async function updateWebhookConfig(id: string, updates: Partial<WebhookConfig>): Promise<WebhookConfig | undefined> {
  const existing = await getWebhookConfig(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...updates, id }; // prevent id change
  const client = getS3Client?.();
  if (!client) throw new Error("S3 client not available for webhook storage");
  await client.uploadJson(`webhooks/${id}.json`, updated);
  return updated;
}

export async function deleteWebhookConfig(id: string): Promise<void> {
  const client = getS3Client?.();
  if (!client) return;
  await client.deleteObject(`webhooks/${id}.json`);
}

// --- Webhook Delivery ---

/**
 * Trigger webhooks for a given event. Non-blocking — logs failures but never throws.
 * Retries once on failure after a 3-second delay.
 */
export async function triggerWebhook(event: string, payload: any): Promise<void> {
  try {
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
  try {
    await deliverWebhook(config, event, body);
  } catch (firstErr) {
    console.warn(`[Webhooks] First attempt failed for ${config.url} (event: ${event}):`, (firstErr as Error).message);
    // Retry once after delay
    await new Promise(resolve => setTimeout(resolve, WEBHOOK_RETRY_DELAY_MS));
    try {
      await deliverWebhook(config, event, body);
    } catch (retryErr) {
      console.error(`[Webhooks] Retry failed for ${config.url} (event: ${event}):`, (retryErr as Error).message);
    }
  }
}

async function deliverWebhook(config: WebhookConfig, event: string, body: string): Promise<void> {
  const signature = createHmac("sha256", config.secret).update(body).digest("hex");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Signature": signature,
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
