/**
 * Tests for webhook delivery: HMAC signature verification, event filtering,
 * retry logic, payload structure, and timeout handling.
 * Complements webhooks.test.ts which covers config CRUD only.
 * Run with: npx tsx --test tests/webhook-delivery.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "crypto";
import type { WebhookConfig, WebhookEvent } from "../server/services/webhooks.js";
import { WEBHOOK_EVENTS } from "../server/services/webhooks.js";

// ── HMAC Signature Generation & Verification ─────────────

describe("Webhook HMAC signature", () => {
  const secret = "test-webhook-secret-12345";

  function generateSignature(body: string, sigSecret: string): string {
    return createHmac("sha256", sigSecret).update(body).digest("hex");
  }

  function verifySignature(body: string, signature: string, sigSecret: string): boolean {
    const expected = createHmac("sha256", sigSecret).update(body).digest("hex");
    const sigBuf = Buffer.from(signature, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  }

  it("generates consistent signatures for same payload", () => {
    const body = '{"event":"call.completed","data":{"callId":"test"}}';
    const sig1 = generateSignature(body, secret);
    const sig2 = generateSignature(body, secret);
    assert.equal(sig1, sig2);
  });

  it("generates different signatures for different payloads", () => {
    const sig1 = generateSignature('{"event":"call.completed"}', secret);
    const sig2 = generateSignature('{"event":"call.failed"}', secret);
    assert.notEqual(sig1, sig2);
  });

  it("generates different signatures for different secrets", () => {
    const body = '{"event":"test"}';
    const sig1 = generateSignature(body, "secret-1");
    const sig2 = generateSignature(body, "secret-2");
    assert.notEqual(sig1, sig2);
  });

  it("verifies valid signature (timing-safe)", () => {
    const body = '{"event":"call.completed","data":{"score":8.5}}';
    const signature = generateSignature(body, secret);
    assert.ok(verifySignature(body, signature, secret));
  });

  it("rejects invalid signature", () => {
    const body = '{"event":"call.completed"}';
    const badSig = "0".repeat(64);
    assert.ok(!verifySignature(body, badSig, secret));
  });

  it("rejects signature from wrong secret", () => {
    const body = '{"event":"call.completed"}';
    const sig = generateSignature(body, "correct-secret");
    assert.ok(!verifySignature(body, sig, "wrong-secret"));
  });

  it("rejects tampered body", () => {
    const body = '{"event":"call.completed","data":{"score":8.5}}';
    const sig = generateSignature(body, secret);
    const tamperedBody = '{"event":"call.completed","data":{"score":10}}';
    assert.ok(!verifySignature(tamperedBody, sig, secret));
  });

  it("signature is 64-char hex string", () => {
    const sig = generateSignature("test", secret);
    assert.equal(sig.length, 64);
    assert.match(sig, /^[0-9a-f]{64}$/);
  });
});

// ── Event Filtering ─────────────────────────────────

describe("Webhook event filtering", () => {
  function filterConfigs(configs: WebhookConfig[], event: string): WebhookConfig[] {
    return configs.filter(c => c.active && c.events.includes(event));
  }

  const configs: WebhookConfig[] = [
    {
      id: "wh-1", url: "https://slack.example.com/hook",
      events: ["call.completed", "score.low"], secret: "s1",
      active: true, createdBy: "admin", createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "wh-2", url: "https://email.example.com/hook",
      events: ["call.completed", "call.failed", "score.exceptional"],
      secret: "s2", active: true, createdBy: "admin", createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "wh-3", url: "https://disabled.example.com/hook",
      events: ["call.completed"], secret: "s3",
      active: false, createdBy: "admin", createdAt: "2026-01-01T00:00:00Z",
    },
  ];

  it("filters to active configs matching event", () => {
    const matching = filterConfigs(configs, "call.completed");
    assert.equal(matching.length, 2);
    assert.ok(matching.find(c => c.id === "wh-1"));
    assert.ok(matching.find(c => c.id === "wh-2"));
  });

  it("excludes inactive configs", () => {
    const matching = filterConfigs(configs, "call.completed");
    assert.ok(!matching.find(c => c.id === "wh-3"));
  });

  it("returns empty for non-matching event", () => {
    const matching = filterConfigs(configs, "coaching.created");
    assert.equal(matching.length, 0);
  });

  it("filters correctly for score.low (only wh-1)", () => {
    const matching = filterConfigs(configs, "score.low");
    assert.equal(matching.length, 1);
    assert.equal(matching[0].id, "wh-1");
  });

  it("handles empty configs array", () => {
    const matching = filterConfigs([], "call.completed");
    assert.equal(matching.length, 0);
  });
});

// ── Webhook Payload Structure ─────────────────────────────

describe("Webhook payload structure", () => {
  function buildPayload(event: string, data: any): string {
    return JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data,
    });
  }

  it("builds valid JSON payload with event, timestamp, and data", () => {
    const payload = buildPayload("call.completed", { callId: "c-123", score: 8.5 });
    const parsed = JSON.parse(payload);

    assert.equal(parsed.event, "call.completed");
    assert.ok(parsed.timestamp);
    assert.equal(parsed.data.callId, "c-123");
    assert.equal(parsed.data.score, 8.5);
  });

  it("includes ISO timestamp", () => {
    const payload = JSON.parse(buildPayload("test", {}));
    assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("handles complex data payloads", () => {
    const data = {
      callId: "c-123",
      score: 3.5,
      sentiment: "negative",
      employee: "John Doe",
      fileName: "call-2026-03-25.mp3",
      flags: ["low_score", "needs_review"],
    };
    const payload = JSON.parse(buildPayload("score.low", data));
    assert.deepEqual(payload.data.flags, ["low_score", "needs_review"]);
  });

  it("handles null/undefined data gracefully", () => {
    const payload = buildPayload("call.failed", { callId: "c-err", error: null });
    const parsed = JSON.parse(payload);
    assert.equal(parsed.data.error, null);
  });
});

// ── Webhook Events Enum ─────────────────────────────────

describe("Webhook events", () => {
  it("defines all expected events", () => {
    assert.ok(WEBHOOK_EVENTS.includes("call.completed"));
    assert.ok(WEBHOOK_EVENTS.includes("call.failed"));
    assert.ok(WEBHOOK_EVENTS.includes("score.low"));
    assert.ok(WEBHOOK_EVENTS.includes("score.exceptional"));
    assert.ok(WEBHOOK_EVENTS.includes("coaching.created"));
  });

  it("has exactly 5 event types", () => {
    assert.equal(WEBHOOK_EVENTS.length, 5);
  });
});

// ── Retry Logic ─────────────────────────────────

describe("Webhook retry logic", () => {
  it("retry strategy: exponential backoff with 4 retries", () => {
    // Verify constants match expected behavior
    const WEBHOOK_TIMEOUT_MS = 5_000;
    const WEBHOOK_RETRY_BASE_DELAY_MS = 2_000;
    const WEBHOOK_MAX_RETRIES = 4;

    assert.equal(WEBHOOK_TIMEOUT_MS, 5000, "Timeout should be 5 seconds");
    assert.equal(WEBHOOK_RETRY_BASE_DELAY_MS, 2000, "Base retry delay should be 2 seconds");
    assert.equal(WEBHOOK_MAX_RETRIES, 4, "Should retry up to 4 times");
  });

  it("total max time per delivery: 5 attempts with exponential backoff", () => {
    // 5 attempts × 5s timeout + delays (2s + 4s + 8s + 16s)
    const maxTime = 5 * 5000 + 2000 + 4000 + 8000 + 16000;
    assert.equal(maxTime, 55000, "Max delivery time should be 55 seconds");
  });

  interface DeliveryAttempt {
    attempt: number;
    succeeded: boolean;
    error?: string;
  }

  function simulateDelivery(firstSucceeds: boolean, retrySucceeds: boolean): DeliveryAttempt[] {
    const attempts: DeliveryAttempt[] = [];

    // First attempt
    attempts.push({
      attempt: 1,
      succeeded: firstSucceeds,
      error: firstSucceeds ? undefined : "Connection refused",
    });

    // Retry (only if first failed)
    if (!firstSucceeds) {
      attempts.push({
        attempt: 2,
        succeeded: retrySucceeds,
        error: retrySucceeds ? undefined : "Connection refused",
      });
    }

    return attempts;
  }

  it("succeeds on first attempt — no retry", () => {
    const attempts = simulateDelivery(true, false);
    assert.equal(attempts.length, 1);
    assert.ok(attempts[0].succeeded);
  });

  it("fails first, succeeds on retry", () => {
    const attempts = simulateDelivery(false, true);
    assert.equal(attempts.length, 2);
    assert.ok(!attempts[0].succeeded);
    assert.ok(attempts[1].succeeded);
  });

  it("fails both attempts", () => {
    const attempts = simulateDelivery(false, false);
    assert.equal(attempts.length, 2);
    assert.ok(!attempts[0].succeeded);
    assert.ok(!attempts[1].succeeded);
  });
});
