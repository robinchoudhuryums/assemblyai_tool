/**
 * Shared Zod schemas for the Simulated Call Generator.
 *
 * These types describe the script + config that drive TTS generation and the
 * resulting simulated_calls row. Imported by both client (script builder
 * form validation) and server (route validation, job payload typing).
 */
import { z } from "zod";

// ── Per-turn script primitives ─────────────────────────────────
export const agentOrCustomer = z.enum(["agent", "customer"]);

export const spokenTurnSchema = z.object({
  speaker: agentOrCustomer,
  text: z.string().min(1).max(2000),
});

export const holdTurnSchema = z.object({
  speaker: z.literal("hold"),
  duration: z.number().min(1).max(300),   // seconds
  playMusic: z.boolean().optional(),
});

export const interruptTurnSchema = z.object({
  speaker: z.literal("interrupt"),
  primarySpeaker: agentOrCustomer,
  text: z.string().min(1).max(2000),
  interruptText: z.string().min(1).max(500),
});

export const simulatedTurnSchema = z.union([
  spokenTurnSchema,
  holdTurnSchema,
  interruptTurnSchema,
]);

// ── Script ─────────────────────────────────────────────────────
export const simulatedCallScriptSchema = z.object({
  title: z.string().min(1).max(500),
  scenario: z.string().max(2000).optional(),
  qualityTier: z.enum(["poor", "acceptable", "excellent"]),
  equipment: z.string().max(255).optional(),
  voices: z.object({
    agent: z.string().min(1),       // ElevenLabs voice ID
    customer: z.string().min(1),
  }),
  turns: z.array(simulatedTurnSchema).min(1).max(200),
});

// ── Audio config ───────────────────────────────────────────────
export const simulatedCallConfigSchema = z.object({
  // Timing
  gapDistribution: z.enum(["fixed", "natural"]).default("natural"),
  gapMeanSeconds: z.number().min(0).max(10).default(0.8),
  gapStdDevSeconds: z.number().min(0).max(5).default(0.3),

  // Audio quality / codec simulation
  connectionQuality: z.enum(["clean", "phone", "degraded", "poor"]).default("phone"),
  backgroundNoise: z.enum(["none", "office", "callcenter", "static"]).default("none"),
  backgroundNoiseLevel: z.number().min(0).max(1).default(0.15),

  // Hold music (S3 key of uploaded MP3/WAV, or null for silence)
  holdMusicUrl: z.string().optional().nullable(),

  // Post-generation: optionally pipe the finished audio into the real
  // analysis pipeline. Defaults false to avoid accidental spend spikes.
  analyzeAfterGeneration: z.boolean().default(false),

  // Realism: inject filler words ("um", "uh") into TTS text based on
  // qualityTier (excellent=none, acceptable=light, poor=heavy). Applied
  // at the TTS-call boundary only — the stored script is NOT mutated.
  // Defaults ON so existing presets get realistic prosody automatically.
  disfluencies: z.boolean().default(true),

  // Realism: overlay short affirmations ("mm-hmm", "okay") from the
  // opposite speaker under eligible primary turns. Adds 1–3 extra
  // ElevenLabs calls per eligible turn (~5–10% cost uplift for calls
  // with many long turns). Off by default on poor-tier calls because
  // poor handling rarely includes active listening.
  backchannels: z.boolean().default(true),
});

// ── Generation request (what the API accepts) ────────────────
export const generateSimulatedCallRequestSchema = z.object({
  script: simulatedCallScriptSchema,
  config: simulatedCallConfigSchema,
});

// ── Stored row (what the server returns) ─────────────────────
export const simulatedCallStatusSchema = z.enum([
  "pending",
  "generating",
  "ready",
  "failed",
]);

export const simulatedCallSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string().nullable().optional(),
  qualityTier: z.string().nullable().optional(),
  equipment: z.string().nullable().optional(),
  status: simulatedCallStatusSchema,
  script: simulatedCallScriptSchema,
  config: simulatedCallConfigSchema,
  audioS3Key: z.string().nullable().optional(),
  audioFormat: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  ttsCharCount: z.number().nullable().optional(),
  estimatedCost: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  createdBy: z.string(),
  sentToAnalysisCallId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type AgentOrCustomer = z.infer<typeof agentOrCustomer>;
export type SpokenTurn = z.infer<typeof spokenTurnSchema>;
export type HoldTurn = z.infer<typeof holdTurnSchema>;
export type InterruptTurn = z.infer<typeof interruptTurnSchema>;
export type SimulatedTurn = z.infer<typeof simulatedTurnSchema>;
export type SimulatedCallScript = z.infer<typeof simulatedCallScriptSchema>;
export type SimulatedCallConfig = z.infer<typeof simulatedCallConfigSchema>;
export type GenerateSimulatedCallRequest = z.infer<typeof generateSimulatedCallRequestSchema>;
export type SimulatedCallStatus = z.infer<typeof simulatedCallStatusSchema>;
export type SimulatedCall = z.infer<typeof simulatedCallSchema>;

// ── Insert type for storage layer ────────────────────────────
export interface InsertSimulatedCall {
  title: string;
  scenario?: string;
  qualityTier?: string;
  equipment?: string;
  script: SimulatedCallScript;
  config: SimulatedCallConfig;
  createdBy: string;
}
