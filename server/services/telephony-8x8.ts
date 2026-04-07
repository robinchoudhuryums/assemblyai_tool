/**
 * 8x8 Telephony Integration Service
 *
 * Provides auto-ingestion of call recordings from 8x8 Work (formerly 8x8 Virtual Office).
 * Uses the 8x8 Work API to poll for new recordings and automatically submit them
 * to the CallAnalyzer pipeline.
 *
 * STATUS: Framework ready. Pending 8x8 Work API access/clarification.
 *
 * Expected 8x8 Work API flow:
 * 1. Authenticate via OAuth2 or API key
 * 2. Poll /analytics/recordings or receive webhook for new recordings
 * 3. Download audio file from 8x8 CDN
 * 4. Submit to processAudioFile() pipeline
 * 5. Map 8x8 extension → employee for auto-assignment
 *
 * Environment variables:
 *   TELEPHONY_8X8_ENABLED=true          — Master toggle
 *   TELEPHONY_8X8_API_KEY=xxx           — 8x8 Work API key
 *   TELEPHONY_8X8_SUBACCOUNT_ID=xxx     — 8x8 subaccount ID
 *   TELEPHONY_8X8_POLL_MINUTES=15       — How often to poll for new recordings
 *   TELEPHONY_8X8_BASE_URL=https://...  — 8x8 API base URL (override for testing)
 */
import { storage } from "../storage";
import { createHash } from "crypto";
import { isUrlSafe } from "./url-validator";

export interface TelephonyConfig {
  enabled: boolean;
  apiKey: string;
  subaccountId: string;
  baseUrl: string;
  pollIntervalMinutes: number;
}

export interface Recording8x8 {
  /** 8x8 recording ID */
  recordingId: string;
  /** Call direction: inbound/outbound */
  direction: "inbound" | "outbound";
  /** 8x8 extension that handled the call */
  extension: string;
  /** External phone number (caller/callee) */
  externalNumber: string;
  /** Call start time (ISO 8601) */
  startTime: string;
  /** Call duration in seconds */
  durationSeconds: number;
  /** URL to download the recording audio */
  audioUrl: string;
  /** 8x8 CDN token for authenticated download */
  downloadToken?: string;
}

export interface IngestionResult {
  recordingId: string;
  callId: string | null;
  status: "ingested" | "duplicate" | "skipped" | "error";
  reason?: string;
}

function getConfig(): TelephonyConfig {
  // A4/F06: NaN-guard the poll interval — parseInt("abc",10)=NaN would later
  // become NaN ms in setInterval, which Node treats as 1ms (busy-loop polling).
  const rawPoll = parseInt(process.env.TELEPHONY_8X8_POLL_MINUTES || "15", 10);
  const pollIntervalMinutes = Number.isFinite(rawPoll) && rawPoll > 0 ? rawPoll : 15;
  return {
    enabled: process.env.TELEPHONY_8X8_ENABLED === "true",
    apiKey: process.env.TELEPHONY_8X8_API_KEY || "",
    subaccountId: process.env.TELEPHONY_8X8_SUBACCOUNT_ID || "",
    baseUrl: process.env.TELEPHONY_8X8_BASE_URL || "https://api.8x8.com/analytics/v2",
    pollIntervalMinutes,
  };
}

/**
 * Check if 8x8 integration is configured and available.
 *
 * HARD DISABLED (A1/F05): The 8x8 integration is a stub pending API access
 * confirmation. Even if TELEPHONY_8X8_ENABLED=true, ingestion will not run
 * unless the explicit acknowledgement flag TELEPHONY_8X8_STUB_ACKNOWLEDGED=true
 * is also set. This prevents accidentally activating an unverified integration
 * that would call provisional API endpoints with provisional response shapes.
 */
export function is8x8Enabled(): boolean {
  const config = getConfig();
  if (!config.enabled || !config.apiKey || !config.subaccountId) return false;
  if (process.env.TELEPHONY_8X8_STUB_ACKNOWLEDGED !== "true") return false;
  return true;
}

/**
 * Fetch recent call recordings from 8x8 Work API.
 *
 * NOTE: This is a stub — actual 8x8 API endpoints and response shapes
 * will be filled in once API access is confirmed. The shape below is
 * based on 8x8 Analytics API documentation.
 */
export async function fetchRecentRecordings(sinceMinutes?: number): Promise<Recording8x8[]> {
  const config = getConfig();
  if (!config.enabled || !config.apiKey) {
    throw new Error("8x8 integration not configured");
  }

  const since = new Date(Date.now() - (sinceMinutes || config.pollIntervalMinutes) * 60 * 1000);
  const sinceStr = since.toISOString();

  // 8x8 Work API call — actual endpoint TBD pending API access
  const url = `${config.baseUrl}/recordings?subAccountId=${config.subaccountId}&startTime=${encodeURIComponent(sinceStr)}&pageSize=50`;

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`8x8 API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();

  // Map 8x8 response to our Recording8x8 shape
  // NOTE: field names are provisional — adjust once API docs are confirmed
  return (data.recordings || data.data || []).map((r: any) => ({
    recordingId: r.recordingId || r.id,
    direction: r.direction === "outbound" ? "outbound" : "inbound",
    extension: r.extension || r.agentExtension || "",
    externalNumber: r.externalNumber || r.callerNumber || r.calleeNumber || "",
    startTime: r.startTime || r.timestamp,
    durationSeconds: r.duration || r.durationSeconds || 0,
    audioUrl: r.audioUrl || r.recordingUrl || "",
    downloadToken: r.downloadToken,
  }));
}

/**
 * Download audio from 8x8 CDN and return as Buffer.
 */
export async function downloadRecordingAudio(recording: Recording8x8): Promise<Buffer> {
  const config = getConfig();
  const headers: Record<string, string> = {};

  if (recording.downloadToken) {
    headers["Authorization"] = `Bearer ${recording.downloadToken}`;
  } else {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  // A4/F17: SSRF guard. recording.audioUrl comes from the upstream 8x8 API
  // response — treat as untrusted. Block private IPs, metadata endpoints,
  // localhost, .internal/.local, IPv6-mapped IPv4, etc. via the shared validator.
  if (!recording.audioUrl || !isUrlSafe(recording.audioUrl)) {
    throw new Error(`Refusing to fetch recording ${recording.recordingId}: audioUrl failed SSRF validation`);
  }

  const response = await fetch(recording.audioUrl, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download recording ${recording.recordingId}: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Map an 8x8 extension to an employee in CallAnalyzer.
 * Returns employee ID if found, undefined otherwise.
 */
export async function mapExtensionToEmployee(extension: string): Promise<string | undefined> {
  if (!extension) return undefined;
  try {
    const employees = await storage.getAllEmployees();
    const match = employees.find(e => e.extension === extension);
    return match?.id;
  } catch {
    return undefined;
  }
}

/**
 * Ingest a single 8x8 recording into the CallAnalyzer pipeline.
 * Checks for duplicates via content hash or external recording ID.
 */
export async function ingestRecording(
  recording: Recording8x8,
  processAudioFn: (callId: string, audioBuffer: Buffer, options: { originalName: string; mimeType: string; callCategory?: string; uploadedBy?: string; processingMode?: string; language?: string; filePath?: string }) => Promise<void>,
): Promise<IngestionResult> {
  try {
    // Skip very short recordings (likely voicemail greetings or test calls)
    if (recording.durationSeconds < 10) {
      return { recordingId: recording.recordingId, callId: null, status: "skipped", reason: "Too short (<10s)" };
    }

    const externalFileName = `8x8-${recording.recordingId}.wav`;
    const externalId = `8x8:${recording.recordingId}`;

    // A10/F03: dedupe by upstream recording id BEFORE downloading audio.
    // findCallByExternalId is an indexed lookup; the previous content-hash
    // approach required pulling the full audio buffer just to skip duplicates.
    const existingByExternalId = await storage.findCallByExternalId(externalId);
    if (existingByExternalId) {
      return { recordingId: recording.recordingId, callId: existingByExternalId.id, status: "duplicate" };
    }

    const audioBuffer = await downloadRecordingAudio(recording);
    const contentHash = createHash("sha256").update(audioBuffer).digest("hex");

    // Belt-and-suspenders: also check content hash, in case the same call
    // was uploaded manually before the auto-ingest path saw it.
    const existingByHash = await storage.findCallByContentHash(contentHash);
    if (existingByHash) {
      return { recordingId: recording.recordingId, callId: existingByHash.id, status: "duplicate" };
    }

    // Map extension to employee
    const employeeId = await mapExtensionToEmployee(recording.extension);

    const callCategory = recording.direction === "outbound" ? "outbound" : "inbound";

    // A4/F01: Use the id assigned by storage.createCall() — the previous code
    // generated a UUID locally and discarded the storage-assigned id, leading
    // to id mismatch between the call row, the audio S3 key, and the pipeline.
    // A4/F02: Status must be "processing" to match the upload route contract;
    // "pending" is not a valid call status in the pipeline state machine.
    const created = await storage.createCall({
      employeeId,
      fileName: externalFileName,
      filePath: `telephony/8x8/${recording.recordingId}`,
      status: "processing",
      duration: recording.durationSeconds,
      callCategory,
      contentHash,
      externalId,
    });
    const callId = created.id;

    // Archive to S3 if available
    try {
      const s3Client = storage.getObjectStorageClient();
      if (s3Client) {
        await s3Client.uploadFile(`audio/${callId}/${externalFileName}`, audioBuffer, "audio/wav");
      }
    } catch (archiveErr) {
      console.warn(`[8x8] Failed to archive audio for ${recording.recordingId}:`, (archiveErr as Error).message);
    }

    // Submit to pipeline (non-blocking)
    processAudioFn(callId, audioBuffer, {
      originalName: externalFileName,
      mimeType: "audio/wav",
      callCategory,
      uploadedBy: "8x8-auto-ingestion",
    }).catch(err => {
      console.error(`[8x8] Pipeline failed for ${recording.recordingId}:`, (err as Error).message);
    });

    console.log(`[8x8] Ingested recording ${recording.recordingId} → call ${callId} (ext: ${recording.extension}, ${recording.durationSeconds}s)`);
    return { recordingId: recording.recordingId, callId, status: "ingested" };
  } catch (error) {
    console.error(`[8x8] Ingestion error for ${recording.recordingId}:`, (error as Error).message);
    return { recordingId: recording.recordingId, callId: null, status: "error", reason: (error as Error).message };
  }
}

/**
 * Poll 8x8 for new recordings and ingest them.
 */
export async function pollAndIngest(
  processAudioFn: (callId: string, audioBuffer: Buffer, options: { originalName: string; mimeType: string; callCategory?: string; uploadedBy?: string; processingMode?: string; language?: string; filePath?: string }) => Promise<void>,
): Promise<IngestionResult[]> {
  if (!is8x8Enabled()) return [];

  const config = getConfig();
  console.log(`[8x8] Polling for new recordings (last ${config.pollIntervalMinutes} minutes)...`);

  try {
    const recordings = await fetchRecentRecordings();
    if (recordings.length === 0) {
      console.log("[8x8] No new recordings found.");
      return [];
    }

    console.log(`[8x8] Found ${recordings.length} recording(s). Ingesting...`);
    const results: IngestionResult[] = [];
    for (const recording of recordings) {
      const result = await ingestRecording(recording, processAudioFn);
      results.push(result);
    }

    const ingested = results.filter(r => r.status === "ingested").length;
    const dupes = results.filter(r => r.status === "duplicate").length;
    const errors = results.filter(r => r.status === "error").length;
    console.log(`[8x8] Poll complete: ${ingested} ingested, ${dupes} duplicates, ${errors} errors.`);

    return results;
  } catch (error) {
    console.error("[8x8] Poll failed:", (error as Error).message);
    return [];
  }
}

// Scheduler
let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollTimeout: ReturnType<typeof setTimeout> | null = null;

export function startTelephonyScheduler(
  processAudioFn: (callId: string, audioBuffer: Buffer, options: { originalName: string; mimeType: string; callCategory?: string; uploadedBy?: string; processingMode?: string; language?: string; filePath?: string }) => Promise<void>,
): () => void {
  if (!is8x8Enabled()) {
    const acked = process.env.TELEPHONY_8X8_STUB_ACKNOWLEDGED === "true";
    const enabled = process.env.TELEPHONY_8X8_ENABLED === "true";
    if (enabled && !acked) {
      console.warn("[8x8] Integration is a STUB pending API access. Refusing to start scheduler. Set TELEPHONY_8X8_STUB_ACKNOWLEDGED=true to override.");
    } else {
      console.log("[8x8] Telephony integration disabled (set TELEPHONY_8X8_ENABLED=true and TELEPHONY_8X8_STUB_ACKNOWLEDGED=true to enable).");
    }
    return () => {};
  }

  const config = getConfig();
  console.log(`[8x8] Telephony auto-ingestion enabled. Polling every ${config.pollIntervalMinutes} minutes.`);

  // First poll after 30 seconds
  pollTimeout = setTimeout(() => pollAndIngest(processAudioFn), 30_000);
  pollInterval = setInterval(() => pollAndIngest(processAudioFn), config.pollIntervalMinutes * 60 * 1000);

  return () => {
    if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    console.log("[8x8] Telephony scheduler stopped.");
  };
}
