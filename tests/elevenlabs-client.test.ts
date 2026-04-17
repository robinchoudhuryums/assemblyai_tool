/**
 * Unit tests for ElevenLabsClient.
 *
 * Network is mocked via `globalThis.fetch`. No real API calls.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ElevenLabsClient, estimateElevenLabsCost } from "../server/services/elevenlabs-client.js";

type FetchMock = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
let originalFetch: typeof fetch;
let originalKey: string | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalKey;
  mock.reset();
});

function mockFetch(impl: FetchMock) {
  globalThis.fetch = impl as unknown as typeof fetch;
}

describe("ElevenLabsClient — availability", () => {
  it("reports unavailable when API key is missing", () => {
    delete process.env.ELEVENLABS_API_KEY;
    const client = new ElevenLabsClient();
    assert.equal(client.isAvailable, false);
  });

  it("reports available when API key is set", () => {
    const client = new ElevenLabsClient();
    assert.equal(client.isAvailable, true);
  });
});

describe("ElevenLabsClient — listVoices", () => {
  it("returns the voices array from /voices", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          voices: [
            { voice_id: "v1", name: "Alice" },
            { voice_id: "v2", name: "Bob" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new ElevenLabsClient();
    const voices = await client.listVoices();
    assert.equal(voices.length, 2);
    assert.equal(voices[0].voice_id, "v1");
  });

  it("throws on non-OK response", async () => {
    mockFetch(async () => new Response("forbidden", { status: 403 }));
    const client = new ElevenLabsClient();
    await assert.rejects(() => client.listVoices(), /403/);
  });

  it("throws when API key is missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const client = new ElevenLabsClient();
    await assert.rejects(() => client.listVoices(), /ELEVENLABS_API_KEY/);
  });
});

describe("ElevenLabsClient — textToSpeech", () => {
  it("returns a Buffer + character count + latency", async () => {
    const fakeBytes = new Uint8Array([1, 2, 3, 4, 5]);
    mockFetch(async () =>
      new Response(fakeBytes, {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    const client = new ElevenLabsClient();
    const res = await client.textToSpeech({ voiceId: "v1", text: "hello world" });
    assert.ok(Buffer.isBuffer(res.audio));
    assert.equal(res.audio.length, 5);
    assert.equal(res.characterCount, 11);
    assert.ok(res.latencyMs >= 0);
  });

  it("retries once on 429, then succeeds", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls === 1) return new Response("rate limited", { status: 429 });
      return new Response(new Uint8Array([9, 9]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    const client = new ElevenLabsClient();
    const res = await client.textToSpeech({ voiceId: "v", text: "hi" });
    assert.equal(calls, 2);
    assert.equal(res.audio.length, 2);
  });

  it("throws on 5xx errors (no retry)", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      return new Response("boom", { status: 500 });
    });
    const client = new ElevenLabsClient();
    await assert.rejects(() => client.textToSpeech({ voiceId: "v", text: "x" }), /500/);
    assert.equal(calls, 1);
  });
});

describe("estimateElevenLabsCost", () => {
  it("defaults to $0.0003 per character", () => {
    assert.equal(estimateElevenLabsCost(1000), 0.3);
    assert.equal(estimateElevenLabsCost(100), 0.03);
  });

  it("honors ELEVENLABS_COST_PER_CHAR env override", () => {
    const prev = process.env.ELEVENLABS_COST_PER_CHAR;
    process.env.ELEVENLABS_COST_PER_CHAR = "0.0001";
    try {
      assert.equal(estimateElevenLabsCost(1000), 0.1);
    } finally {
      if (prev === undefined) delete process.env.ELEVENLABS_COST_PER_CHAR;
      else process.env.ELEVENLABS_COST_PER_CHAR = prev;
    }
  });

  it("falls back to default on invalid env values", () => {
    const prev = process.env.ELEVENLABS_COST_PER_CHAR;
    process.env.ELEVENLABS_COST_PER_CHAR = "not-a-number";
    try {
      assert.equal(estimateElevenLabsCost(1000), 0.3);
    } finally {
      if (prev === undefined) delete process.env.ELEVENLABS_COST_PER_CHAR;
      else process.env.ELEVENLABS_COST_PER_CHAR = prev;
    }
  });
});
