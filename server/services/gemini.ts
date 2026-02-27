/**
 * Gemini AI provider for call analysis.
 *
 * Supports two authentication modes:
 * 1. GEMINI_API_KEY — Google AI Studio (simplest, great for testing)
 * 2. Service account credentials — Vertex AI (production / BAA)
 *    Credential priority: GEMINI_CREDENTIALS > GCS_CREDENTIALS > GOOGLE_APPLICATION_CREDENTIALS
 */
import { createSign } from "crypto";
import fs from "fs";
import type { AIAnalysisProvider, CallAnalysis } from "./ai-provider";
import { buildAnalysisPrompt, parseJsonResponse } from "./ai-provider";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
}

type AuthMode = "api_key" | "vertex_ai" | "none";

const DEFAULT_MODEL_API_KEY = "gemini-2.5-flash";
const DEFAULT_MODEL_VERTEX = "gemini-2.0-flash";

export class GeminiProvider implements AIAnalysisProvider {
  readonly name = "gemini";
  private authMode: AuthMode = "none";
  private apiKey: string | null = null;
  private credentials: ServiceAccountKey | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private model: string;

  constructor() {
    // Priority 1: GEMINI_API_KEY (Google AI Studio)
    if (process.env.GEMINI_API_KEY) {
      this.apiKey = process.env.GEMINI_API_KEY;
      this.authMode = "api_key";
      this.model = process.env.GEMINI_MODEL || DEFAULT_MODEL_API_KEY;
      console.log(`Gemini provider initialized (mode: API key via AI Studio, model: ${this.model})`);
      return;
    }

    // Priority 2+: Service account credentials for Vertex AI
    this.model = process.env.GEMINI_MODEL || DEFAULT_MODEL_VERTEX;
    try {
      this.credentials = this.loadServiceAccountCredentials();
      this.authMode = "vertex_ai";
      console.log(`Gemini provider initialized (mode: Vertex AI, project: ${this.credentials.project_id}, model: ${this.model})`);
    } catch {
      console.warn("Gemini provider: No credentials found.");
    }
  }

  get isAvailable(): boolean {
    return this.authMode !== "none";
  }

  private loadServiceAccountCredentials(): ServiceAccountKey {
    if (process.env.GEMINI_CREDENTIALS) {
      return JSON.parse(process.env.GEMINI_CREDENTIALS);
    }
    if (process.env.GCS_CREDENTIALS) {
      return JSON.parse(process.env.GCS_CREDENTIALS);
    }
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

  async analyzeCallTranscript(transcriptText: string, callId: string): Promise<CallAnalysis> {
    if (this.authMode === "none") {
      throw new Error("Gemini provider not configured");
    }

    const model = this.model;
    const prompt = buildAnalysisPrompt(transcriptText);

    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    };

    let response: Response;

    if (this.authMode === "api_key") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      console.log(`[${callId}] Calling Gemini (${model}, AI Studio) for analysis...`);
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } else {
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

    // Gemini 2.5+ models may return a "thought" part before the actual text.
    const parts = result.candidates?.[0]?.content?.parts || [];
    let responseText = "";
    for (const part of parts) {
      if (part.text && !part.thought) {
        responseText = part.text;
        break;
      }
    }
    if (!responseText && parts.length > 0) {
      responseText = parts[parts.length - 1].text || "";
    }

    const analysis = parseJsonResponse(responseText, callId);
    console.log(`[${callId}] Gemini analysis complete (score: ${analysis.performance_score}/10, sentiment: ${analysis.sentiment})`);
    return analysis;
  }
}
