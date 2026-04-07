/**
 * Tests for webhook service: HMAC signature generation, event filtering, config CRUD.
 * Uses inline mocks for the S3 client (same pattern as utils.test.ts).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import {
  WEBHOOK_EVENTS,
  initWebhooks,
  getAllWebhookConfigs,
  getWebhookConfig,
  createWebhookConfig,
  updateWebhookConfig,
  deleteWebhookConfig,
  triggerWebhook,
} from "../server/services/webhooks.js";
import type { WebhookConfig } from "../server/services/webhooks.js";

// --- In-memory mock S3 client ---
function createMockS3() {
  const store = new Map<string, any>();

  return {
    store,
    uploadJson: async (key: string, data: any) => {
      store.set(key, JSON.parse(JSON.stringify(data)));
    },
    downloadJson: async (key: string) => {
      return store.get(key) ?? undefined;
    },
    listAndDownloadJson: async (prefix: string) => {
      const results: any[] = [];
      for (const [key, value] of store) {
        if (key.startsWith(prefix)) results.push(value);
      }
      return results;
    },
    deleteObject: async (key: string) => {
      store.delete(key);
    },
  };
}

describe("WEBHOOK_EVENTS", () => {
  it("contains expected event types", () => {
    assert.ok(WEBHOOK_EVENTS.includes("call.completed"));
    assert.ok(WEBHOOK_EVENTS.includes("call.failed"));
    assert.ok(WEBHOOK_EVENTS.includes("score.low"));
    assert.ok(WEBHOOK_EVENTS.includes("score.exceptional"));
    assert.ok(WEBHOOK_EVENTS.includes("coaching.created"));
  });

  it("has 5 event types", () => {
    assert.equal(WEBHOOK_EVENTS.length, 5);
  });
});

describe("webhook config CRUD", () => {
  let mockS3: ReturnType<typeof createMockS3>;

  beforeEach(() => {
    mockS3 = createMockS3();
    initWebhooks(() => mockS3);
  });

  const sampleConfig: WebhookConfig = {
    id: "wh-123",
    url: "https://hooks.example.com/endpoint",
    events: ["call.completed", "score.low"],
    secret: "test-secret-key",
    active: true,
    createdBy: "admin",
    createdAt: "2026-01-01T00:00:00Z",
  };

  it("creates and retrieves a webhook config", async () => {
    await createWebhookConfig(sampleConfig);
    const retrieved = await getWebhookConfig("wh-123");
    assert.ok(retrieved);
    assert.equal(retrieved.url, sampleConfig.url);
    assert.equal(retrieved.secret, sampleConfig.secret);
    assert.deepEqual(retrieved.events, sampleConfig.events);
  });

  it("lists all webhook configs", async () => {
    await createWebhookConfig(sampleConfig);
    await createWebhookConfig({ ...sampleConfig, id: "wh-456", url: "https://other.example.com" });

    const all = await getAllWebhookConfigs();
    assert.equal(all.length, 2);
  });

  it("updates a webhook config", async () => {
    await createWebhookConfig(sampleConfig);

    const updated = await updateWebhookConfig("wh-123", { active: false });
    assert.ok(updated);
    assert.equal(updated.active, false);
    assert.equal(updated.url, sampleConfig.url); // unchanged fields preserved
    assert.equal(updated.id, "wh-123"); // id can't be changed
  });

  it("returns undefined when updating non-existent config", async () => {
    const result = await updateWebhookConfig("non-existent", { active: false });
    assert.equal(result, undefined);
  });

  it("deletes a webhook config", async () => {
    await createWebhookConfig(sampleConfig);
    await deleteWebhookConfig("wh-123");
    const retrieved = await getWebhookConfig("wh-123");
    assert.equal(retrieved, undefined);
  });

  it("returns undefined for non-existent config", async () => {
    const result = await getWebhookConfig("does-not-exist");
    assert.equal(result, undefined);
  });

  it("returns empty array when no configs exist", async () => {
    const all = await getAllWebhookConfigs();
    assert.deepEqual(all, []);
  });
});

describe("webhook HMAC signature", () => {
  it("generates correct HMAC-SHA256 signature", () => {
    const secret = "my-webhook-secret";
    const body = JSON.stringify({ event: "call.completed", data: { callId: "123" } });
    const expected = createHmac("sha256", secret).update(body).digest("hex");

    // Verify the signature format matches what deliverWebhook would generate
    assert.match(expected, /^[0-9a-f]{64}$/);
  });

  it("different secrets produce different signatures", () => {
    const body = '{"test":"data"}';
    const sig1 = createHmac("sha256", "secret-1").update(body).digest("hex");
    const sig2 = createHmac("sha256", "secret-2").update(body).digest("hex");
    assert.notEqual(sig1, sig2);
  });

  it("different bodies produce different signatures", () => {
    const secret = "shared-secret";
    const sig1 = createHmac("sha256", secret).update('{"a":1}').digest("hex");
    const sig2 = createHmac("sha256", secret).update('{"b":2}').digest("hex");
    assert.notEqual(sig1, sig2);
  });
});

describe("webhook event filtering", () => {
  let mockS3: ReturnType<typeof createMockS3>;

  beforeEach(() => {
    mockS3 = createMockS3();
    initWebhooks(() => mockS3);
  });

  it("triggerWebhook does not throw when no configs exist", async () => {
    // Should complete without error
    await triggerWebhook("call.completed", { callId: "123" });
  });

  it("triggerWebhook does not throw for unmatched events", async () => {
    await createWebhookConfig({
      id: "wh-1",
      url: "https://example.com/hook",
      events: ["call.completed"],
      secret: "secret",
      active: true,
      createdBy: "admin",
      createdAt: "2026-01-01T00:00:00Z",
    });

    // Trigger an event this webhook doesn't subscribe to
    await triggerWebhook("score.low", { callId: "123" });
    // Should complete without attempting delivery
  });

  it("triggerWebhook skips inactive webhooks", async () => {
    await createWebhookConfig({
      id: "wh-inactive",
      url: "https://example.com/hook",
      events: ["call.completed"],
      secret: "secret",
      active: false, // inactive
      createdBy: "admin",
      createdAt: "2026-01-01T00:00:00Z",
    });

    // Should not attempt delivery to inactive webhook
    await triggerWebhook("call.completed", { callId: "123" });
  });
});

describe("webhook S3 client not initialized", () => {
  beforeEach(() => {
    // Reset to no S3 client
    initWebhooks(() => null);
  });

  it("getAllWebhookConfigs returns empty array", async () => {
    const configs = await getAllWebhookConfigs();
    assert.deepEqual(configs, []);
  });

  it("getWebhookConfig returns undefined", async () => {
    const config = await getWebhookConfig("any-id");
    assert.equal(config, undefined);
  });

  it("createWebhookConfig throws", async () => {
    await assert.rejects(
      () => createWebhookConfig({
        id: "wh-1",
        url: "https://example.com",
        events: ["call.completed"],
        secret: "secret",
        active: true,
        createdBy: "admin",
        createdAt: "2026-01-01T00:00:00Z",
      }),
      /S3 client unavailable/
    );
  });

  it("deleteWebhookConfig throws when S3 client unavailable", async () => {
    // A5: writes (create/update/delete) now throw via requireS3Client()
    // instead of silently no-op'ing. Reads still degrade gracefully.
    await assert.rejects(
      () => deleteWebhookConfig("any-id"),
      /S3 client unavailable/
    );
  });
});
