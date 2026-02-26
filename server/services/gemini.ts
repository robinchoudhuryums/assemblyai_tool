/**
 * Gemini AI client for call analysis (summary, scoring, feedback).
 * Replaces LeMUR. Supports two authentication modes:
 *
 * 1. GEMINI_API_KEY — Google AI Studio API key (simplest, great for testing)
 *    Uses: generativelanguage.googleapis.com
 *    Get a key at: https://aistudio.google.com/apikey
 *
 * 2. Service account credentials (Vertex AI) — for production / BAA environments
 *    Uses: {region}-aiplatform.googleapis.com
 *    Credential priority: GEMINI_CREDENTIALS > GCS_CREDENTIALS > GOOGLE_APPLICATION_CREDENTIALS
 */
import { createSign } from "crypto";
import fs from "fs";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

export interface GeminiAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  sentiment_score: number;
  performance_score: number;
  action_items: string[];
  feedback: {
    strengths: string[];
    suggestions: string[];
  };
}

type AuthMode = "api_key" | "vertex_ai" | "none";

// Default models per auth mode. The free tier for 2.0-flash on AI Studio is
// heavily restricted (limit: 0 in many regions), so default to 1.5-flash there.
const DEFAULT_MODEL_API_KEY = "gemini-1.5-flash";
const DEFAULT_MODEL_VERTEX = "gemini-2.0-flash";

export class GeminiService {
  private authMode: AuthMode = "none";
  private apiKey: string | null = null;
  private credentials: ServiceAccountKey | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private model: string;

  constructor() {
    // Priority 1: GEMINI_API_KEY (Google AI Studio — simplest for personal/testing)
    if (process.env.GEMINI_API_KEY) {
      this.apiKey = process.env.GEMINI_API_KEY;
      this.authMode = "api_key";
      this.model = process.env.GEMINI_MODEL || DEFAULT_MODEL_API_KEY;
      console.log(`Gemini service initialized (mode: API key via AI Studio, model: ${this.model})`);
      return;
    }

    // Priority 2+: Service account credentials for Vertex AI
    this.model = process.env.GEMINI_MODEL || DEFAULT_MODEL_VERTEX;
    try {
      this.credentials = this.loadServiceAccountCredentials();
      this.authMode = "vertex_ai";
      console.log(`Gemini service initialized (mode: Vertex AI, project: ${this.credentials.project_id}, model: ${this.model})`);
    } catch {
      console.warn("Gemini service: No credentials found. AI analysis will be unavailable.");
    }
  }

  get isAvailable(): boolean {
    return this.authMode !== "none";
  }

  private loadServiceAccountCredentials(): ServiceAccountKey {
    // Priority 2: Dedicated GEMINI_CREDENTIALS (separate from GCS)
    if (process.env.GEMINI_CREDENTIALS) {
      return JSON.parse(process.env.GEMINI_CREDENTIALS);
    }
    // Priority 3: Shared GCS credentials
    if (process.env.GCS_CREDENTIALS) {
      return JSON.parse(process.env.GCS_CREDENTIALS);
    }
    // Priority 4: File-based credentials
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const raw = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf-8");
      return JSON.parse(raw);
    }
    throw new Error("No Google credentials configured");
  }

  // --- Vertex AI auth (service account JWT) ---

  private createJwt(): string {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const claimSet = Buffer.from(
      JSON.stringify({
        iss: this.credentials!.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    ).toString("base64url");

    const signatureInput = `${header}.${claimSet}`;
    const sign = createSign("RSA-SHA256");
    sign.update(signatureInput);
    const signature = sign.sign(this.credentials!.private_key, "base64url");

    return `${signatureInput}.${signature}`;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 300_000) {
      return this.accessToken;
    }

    const jwt = this.createJwt();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${await response.text()}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken!;
  }

  // --- Core analysis ---

  async analyzeCallTranscript(transcriptText: string, callId: string): Promise<GeminiAnalysis> {
    if (this.authMode === "none") {
      throw new Error("Gemini service not configured");
    }

    const model = this.model;
    const prompt = this.buildPrompt(transcriptText);

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    };

    let response: Response;

    if (this.authMode === "api_key") {
      // Google AI Studio endpoint (API key auth)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      console.log(`[${callId}] Calling Gemini (${model}, AI Studio) for analysis...`);
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } else {
      // Vertex AI endpoint (service account auth)
      const token = await this.getAccessToken();
      const projectId = this.credentials!.project_id;
      const location = "us-central1";
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
      console.log(`[${callId}] Calling Gemini (${model}, Vertex AI) for analysis...`);
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Extract JSON from response (handle potential markdown fences)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[${callId}] Gemini response was not parseable JSON:`, responseText.slice(0, 200));
      throw new Error("Gemini response did not contain valid JSON");
    }

    const analysis: GeminiAnalysis = JSON.parse(jsonMatch[0]);
    console.log(`[${callId}] Gemini analysis complete (score: ${analysis.performance_score}/10, sentiment: ${analysis.sentiment})`);
    return analysis;
  }

  private buildPrompt(transcriptText: string): string {
    return `You are analyzing a customer service call transcript for a medical supply company. Analyze the following transcript and provide your assessment.

TRANSCRIPT:
${transcriptText}

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "A concise one-paragraph summary of what happened in the call",
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "sentiment_score": 0.0,
  "performance_score": 0.0,
  "action_items": ["action1", "action2"],
  "feedback": {
    "strengths": ["strength1", "strength2"],
    "suggestions": ["suggestion1", "suggestion2"]
  }
}

Guidelines:
- sentiment_score: 0.0 to 1.0 (1.0 = most positive)
- performance_score: 0.0 to 10.0 (10.0 = best)
- Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols
- Be specific in strengths and suggestions — reference actual moments from the call
- Include 2-4 action items that are concrete and actionable
- Topics should be specific (e.g. "order tracking", "billing dispute") not generic`;
  }
}

export const geminiService = new GeminiService();
