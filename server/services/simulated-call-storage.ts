/**
 * Dedicated storage for simulated (synthetic) calls.
 *
 * Uses the pg Pool directly rather than the IStorage abstraction because:
 *   - This feature intrinsically requires PostgreSQL (needs the durable
 *     JobQueue, which also requires DATABASE_URL).
 *   - Adding ~7 methods to the 3-backend IStorage interface just for an
 *     admin QA tool would bloat the core abstraction.
 *   - Mirrors the pattern used by scheduled-reports.ts.
 *
 * If DATABASE_URL is not set, every function here throws. Routes guard on
 * `isSimulatedCallsAvailable()` before calling.
 */
import { randomUUID } from "crypto";
import { getPool } from "../db/pool";
import { logger } from "./logger";
import type {
  SimulatedCall,
  SimulatedCallScript,
  SimulatedCallConfig,
  SimulatedCallStatus,
  InsertSimulatedCall,
} from "@shared/simulated-call-schema";

export function isSimulatedCallsAvailable(): boolean {
  return getPool() !== null;
}

function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error(
      "Simulated calls require DATABASE_URL — PostgreSQL is not configured",
    );
  }
  return pool;
}

function mapRow(row: any): SimulatedCall {
  return {
    id: row.id,
    title: row.title,
    scenario: row.scenario,
    qualityTier: row.quality_tier,
    equipment: row.equipment,
    status: row.status as SimulatedCallStatus,
    script: row.script as SimulatedCallScript,
    config: row.config as SimulatedCallConfig,
    audioS3Key: row.audio_s3_key,
    audioFormat: row.audio_format,
    durationSeconds: row.duration_seconds,
    ttsCharCount: row.tts_char_count,
    estimatedCost: row.estimated_cost !== null && row.estimated_cost !== undefined
      ? parseFloat(row.estimated_cost)
      : null,
    error: row.error,
    createdBy: row.created_by,
    sentToAnalysisCallId: row.sent_to_analysis_call_id,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

export async function createSimulatedCall(
  input: InsertSimulatedCall,
): Promise<SimulatedCall> {
  const pool = requirePool();
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO simulated_calls
       (id, title, scenario, quality_tier, equipment, status, script, config, created_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8)
     RETURNING *`,
    [
      id,
      input.title,
      input.scenario ?? null,
      input.qualityTier ?? null,
      input.equipment ?? null,
      JSON.stringify(input.script),
      JSON.stringify(input.config),
      input.createdBy,
    ],
  );
  return mapRow(rows[0]);
}

/**
 * Look up a simulated-call row by the `calls.id` it was analyzed under
 * (persisted via `sent_to_analysis_call_id`). Used by the post-analysis
 * calibration-assertion hook (Tier C #9) to find the preset row + its
 * expectedScoreRange so the assertion can fire. Returns undefined when no
 * match or when DB is unavailable.
 */
export async function findSimulatedCallBySentToAnalysisCallId(
  sentToAnalysisCallId: string,
): Promise<SimulatedCall | undefined> {
  if (!isSimulatedCallsAvailable()) return undefined;
  const pool = requirePool();
  const { rows } = await pool.query(
    `SELECT * FROM simulated_calls WHERE sent_to_analysis_call_id = $1 LIMIT 1`,
    [sentToAnalysisCallId],
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function getSimulatedCall(id: string): Promise<SimulatedCall | undefined> {
  const pool = requirePool();
  const { rows } = await pool.query(
    `SELECT * FROM simulated_calls WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function listSimulatedCalls(options: {
  createdBy?: string;
  status?: SimulatedCallStatus;
  limit?: number;
}): Promise<SimulatedCall[]> {
  const pool = requirePool();
  const params: unknown[] = [];
  const where: string[] = [];
  if (options.createdBy) {
    params.push(options.createdBy);
    where.push(`created_by = $${params.length}`);
  }
  if (options.status) {
    params.push(options.status);
    where.push(`status = $${params.length}`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM simulated_calls
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapRow);
}

/**
 * List simulated calls whose `config.expectedScoreRange` is set. Used by the
 * calibration-suite runner — these are the presets that assert an expected
 * performance score, so the suite can compare actual vs expected and flag
 * scoring regressions. Returns newest-first, unbounded (there are never many).
 */
export async function listCalibrationPresets(): Promise<SimulatedCall[]> {
  const pool = requirePool();
  const { rows } = await pool.query(
    `SELECT * FROM simulated_calls
     WHERE config ? 'expectedScoreRange'
     ORDER BY created_at DESC`,
  );
  return rows.map(mapRow);
}

export interface UpdateSimulatedCallPatch {
  status?: SimulatedCallStatus;
  audioS3Key?: string | null;
  audioFormat?: string;
  durationSeconds?: number | null;
  ttsCharCount?: number;
  estimatedCost?: number;
  error?: string | null;
  sentToAnalysisCallId?: string | null;
}

export async function updateSimulatedCall(
  id: string,
  patch: UpdateSimulatedCallPatch,
): Promise<SimulatedCall | undefined> {
  const pool = requirePool();
  // Whitelist of mappable columns — rejects silent drop of unknown keys.
  const COLUMN_MAP: Record<keyof UpdateSimulatedCallPatch, string> = {
    status: "status",
    audioS3Key: "audio_s3_key",
    audioFormat: "audio_format",
    durationSeconds: "duration_seconds",
    ttsCharCount: "tts_char_count",
    estimatedCost: "estimated_cost",
    error: "error",
    sentToAnalysisCallId: "sent_to_analysis_call_id",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(COLUMN_MAP) as Array<[keyof UpdateSimulatedCallPatch, string]>) {
    if (key in patch) {
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) {
    return getSimulatedCall(id);
  }
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE simulated_calls SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}

export async function deleteSimulatedCall(id: string): Promise<boolean> {
  const pool = requirePool();
  const { rowCount } = await pool.query(
    `DELETE FROM simulated_calls WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Count simulated call generations per day by a given user.
 * Used by the daily-cap guard on the generate endpoint.
 */
export async function countSimulatedCallsToday(createdBy: string): Promise<number> {
  const pool = requirePool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM simulated_calls
     WHERE created_by = $1 AND created_at >= CURRENT_DATE`,
    [createdBy],
  );
  return rows[0]?.c ?? 0;
}

// Module-level warning surfaced once on first non-DB call attempt.
let warnedNoDB = false;
export function warnSimulatedCallsUnavailableOnce() {
  if (warnedNoDB) return;
  warnedNoDB = true;
  logger.warn(
    "Simulated Call Generator unavailable: DATABASE_URL is not set. Feature disabled.",
  );
}

/**
 * Shared "send to real analysis pipeline" logic, used by both the explicit
 * POST /:id/analyze route and the post-generation hook triggered by
 * `config.analyzeAfterGeneration`.
 *
 * Side effects: creates a `calls` row with synthetic=TRUE, links it back
 * via simulated_calls.sent_to_analysis_call_id, and enqueues a
 * `process_audio` job. `external_id="sim:<id>"` dedupes double-invocations.
 *
 * Status codes returned via the throw — callers translate to HTTP:
 *   - "not_ready" when status !== "ready" or audio_s3_key missing
 *   - "already_sent" when sent_to_analysis_call_id is already set
 *   - "db_not_available" when getPool() returns null
 *   - "no_job_queue" when the job queue is not running
 *
 * The jobQueue argument is `unknown` to avoid a cyclic import with
 * server/services/job-queue.ts's JobQueue class — callers pass the live
 * instance and we duck-call `.enqueue()`.
 */
export class SendToAnalysisError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "SendToAnalysisError";
  }
}

export interface SendToAnalysisResult {
  simulatedCallId: string;
  callId: string;
  externalId: string;
}

export async function sendSimulatedCallToAnalysis(params: {
  simulatedCallId: string;
  uploadedBy: string;
  jobQueue: { enqueue: (type: string, payload: Record<string, unknown>, priority?: number) => Promise<string> } | null;
  /**
   * Inject the storage instance so this module doesn't import ../storage
   * (cycle risk). Typed as `any` for param flexibility — we only use
   * `createCall`, whose real signature is enforced at the call site.
   */
  storage: {
    createCall: (call: any) => Promise<{ id: string }>;
  };
}): Promise<SendToAnalysisResult> {
  const row = await getSimulatedCall(params.simulatedCallId);
  if (!row) {
    throw new SendToAnalysisError("Simulated call not found", "not_found");
  }
  if (row.status !== "ready" || !row.audioS3Key) {
    throw new SendToAnalysisError("Simulated call is not ready yet", "not_ready");
  }
  if (row.sentToAnalysisCallId) {
    throw new SendToAnalysisError("Already sent to analysis", "already_sent");
  }
  if (!params.jobQueue) {
    throw new SendToAnalysisError("Job queue is not running", "no_job_queue");
  }

  const externalId = `sim:${row.id}`;
  let call: { id: string };
  try {
    call = await params.storage.createCall({
      fileName: `${row.title}.mp3`,
      filePath: row.audioS3Key,
      status: "processing",
      synthetic: true,
      externalId,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      // external_id unique violation — another concurrent caller beat us.
      throw new SendToAnalysisError("Already sent to analysis", "already_sent");
    }
    throw err;
  }

  await updateSimulatedCall(row.id, { sentToAnalysisCallId: call.id });

  await params.jobQueue.enqueue("process_audio", {
    callId: call.id,
    filePath: "",
    originalName: `${row.title}.mp3`,
    mimeType: "audio/mpeg",
    callCategory: null,
    uploadedBy: params.uploadedBy,
    processingMode: "immediate",
    language: "en",
  });

  return { simulatedCallId: row.id, callId: call.id, externalId };
}
