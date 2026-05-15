/**
 * Tests for the streamAudio storage primitive — verifies Range-request
 * semantics on the MemStorage in-memory fallback (which is also used in
 * dev and as the cheap correctness baseline for the S3-backed paths).
 *
 * The PostgresStorage + CloudStorage paths delegate to S3Client.streamObject,
 * which is exercised by the e2e Playwright spec via MSW handlers — covering
 * the wire-level Range header forwarding + 206 + 416 propagation.
 *
 * Run with: npx tsx --test tests/streaming-audio.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage.js";

let storage: MemStorage;
const callId = "test-call-001";
const fileName = "audio.mp3";
const objectName = `audio/${callId}/${fileName}`;
const SAMPLE = Buffer.from("0123456789ABCDEFGHIJ"); // 20 bytes, easy to slice

beforeEach(async () => {
  storage = new MemStorage();
  await storage.uploadAudio(callId, fileName, SAMPLE, "audio/mpeg");
});

describe("streamAudio — full responses", () => {
  it("returns 200 + full body when no Range header is set", async () => {
    const resp = await storage.streamAudio(objectName);
    assert.ok(resp);
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get("Content-Length"), String(SAMPLE.length));
    assert.equal(resp.headers.get("Accept-Ranges"), "bytes");
    const buf = Buffer.from(await resp.arrayBuffer());
    assert.deepEqual(buf, SAMPLE);
  });

  it("returns undefined for a missing object", async () => {
    const resp = await storage.streamAudio("audio/nonexistent/no.mp3");
    assert.equal(resp, undefined);
  });
});

describe("streamAudio — range requests", () => {
  it("returns 206 + slice for a valid bytes=N-M range", async () => {
    const resp = await storage.streamAudio(objectName, "bytes=5-9");
    assert.ok(resp);
    assert.equal(resp.status, 206);
    assert.equal(resp.headers.get("Content-Range"), `bytes 5-9/${SAMPLE.length}`);
    assert.equal(resp.headers.get("Content-Length"), "5");
    const buf = Buffer.from(await resp.arrayBuffer());
    assert.deepEqual(buf, SAMPLE.subarray(5, 10));
  });

  it("returns 206 + tail for an open-ended bytes=N- range", async () => {
    const resp = await storage.streamAudio(objectName, "bytes=10-");
    assert.ok(resp);
    assert.equal(resp.status, 206);
    assert.equal(resp.headers.get("Content-Range"), `bytes 10-19/${SAMPLE.length}`);
    assert.equal(resp.headers.get("Content-Length"), "10");
    const buf = Buffer.from(await resp.arrayBuffer());
    assert.deepEqual(buf, SAMPLE.subarray(10));
  });

  it("returns 416 for a malformed Range header", async () => {
    const resp = await storage.streamAudio(objectName, "garbage");
    assert.ok(resp);
    assert.equal(resp.status, 416);
    assert.match(resp.headers.get("Content-Range") ?? "", /^bytes \*\/\d+$/);
  });

  it("returns 416 for an out-of-range end", async () => {
    const resp = await storage.streamAudio(objectName, "bytes=5-100");
    assert.ok(resp);
    assert.equal(resp.status, 416);
  });

  it("returns 416 when start > end", async () => {
    const resp = await storage.streamAudio(objectName, "bytes=10-5");
    assert.ok(resp);
    assert.equal(resp.status, 416);
  });

  it("returns 416 when start is negative-shaped (caught by regex)", async () => {
    // The regex ^bytes=(\d+)-(\d*)$ rejects "bytes=-5-10"; we expect 416.
    const resp = await storage.streamAudio(objectName, "bytes=-5");
    assert.ok(resp);
    assert.equal(resp.status, 416);
  });
});

describe("streamAudio — parity with downloadAudio", () => {
  it("piped streamAudio body matches downloadAudio buffer bytewise", async () => {
    const buffered = await storage.downloadAudio(objectName);
    const resp = await storage.streamAudio(objectName);
    assert.ok(resp && buffered);
    const streamed = Buffer.from(await resp.arrayBuffer());
    assert.deepEqual(streamed, buffered);
  });
});
