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
import { randomUUID } from "crypto";

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
  return {
    enabled: process.env.TELEPHONY_8X8_ENABLED === "true",
    apiKey: process.env.TELEPHONY_8X8_API_KEY || "",
    subaccountId: process.env.TELEPHONY_8X8_SUBACCOUNT_ID || "",
    baseUrl: process.env.TELEPHONY_8X8_BASE_URL || "https://api.8x8.com/analytics/v2",
    pollIntervalMinutes: parseInt(process.env.TELEPHONY_8X8_POLL_MINUTES || "15", 10),
  };
}

/**
 * Check if 8x8 integration is configured and available.
 */
export function is8x8Enabled(): boolean {
  const config = getConfig();
  return config.enabled && !!config.apiKey && !!config.subaccountId;
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
  processAudioFn: (callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string, uploadedBy?: string, processingMode?: string, language?: string) => Promise<void>,
): Promise<IngestionResult> {
  try {
    // Skip very short recordings (likely voicemail greetings or test calls)
    if (recording.durationSeconds < 10) {
      return { recordingId: recording.recordingId, callId: null, status: "skipped", reason: "Too short (<10s)" };
    }

    // Check for duplicate by recording ID in filename convention
    const externalFileName = `8x8-${recording.recordingId}.wav`;
    const existingCalls = await storage.getAllCalls();
    const duplicate = existingCalls.find(c => c.fileName === externalFileName);
    if (duplicate) {
      return { recordingId: recording.recordingId, callId: duplicate.id, status: "duplicate" };
    }

    // Download audio
    const audioBuffer = await downloadRecordingAudio(recording);

    // Map extension to employee
    const employeeId = await mapExtensionToEmployee(recording.extension);

    // Create call record
    const callId = randomUUID();
    const callCategory = recording.direction === "outbound" ? "outbound" : "inbound";

    await storage.createCall({
      employeeId,
      fileName: externalFileName,
      filePath: `telephony/8x8/${recording.recordingId}`,
      status: "pending",
      duration: recording.durationSeconds,
      callCategory,
    });

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
    processAudioFn(
      callId,
      `telephony/8x8/${recording.recordingId}`,
      audioBuffer,
      externalFileName,
      "audio/wav",
      callCategory,
      "8x8-auto-ingestion",
    ).catch(err => {
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
  processAudioFn: (callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string, uploadedBy?: string, processingMode?: string, language?: string) => Promise<void>,
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
  processAudioFn: (callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string, uploadedBy?: string, processingMode?: string, language?: string) => Promise<void>,
): () => void {
  if (!is8x8Enabled()) {
    console.log("[8x8] Telephony integration disabled (set TELEPHONY_8X8_ENABLED=true to enable).");
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
