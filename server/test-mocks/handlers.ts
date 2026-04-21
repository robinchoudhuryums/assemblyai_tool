/**
 * MSW-Node request handlers for E2E-mode dev server.
 *
 * These intercept outbound fetch calls from the Node process to
 * AssemblyAI + Bedrock + S3 so the e2e Playwright tests can drive the
 * full audio pipeline without hitting real external services.
 *
 * Activated only when `E2E_MOCKS=true` at startup (see
 * `server/test-mocks/setup.ts`). Zero effect on production builds —
 * the whole module is skipped when the env flag is absent.
 *
 * Handler strategy:
 *   - AssemblyAI upload       → return a fake upload URL
 *   - AssemblyAI transcribe   → return a transcript ID
 *   - AssemblyAI poll         → return a completed transcript with
 *                                a deterministic transcript text
 *   - Bedrock Converse        → return a hand-rolled analysis JSON
 *   - S3 PUT/GET              → accept + echo (so audio archive works
 *                                without real S3 creds)
 *
 * The test transcript + analysis are fixed — callers relying on
 * non-deterministic AI output should seed more realistic fixtures via
 * the API directly rather than rely on these defaults.
 */
import { http, HttpResponse, type HttpHandler } from "msw";

const FAKE_TRANSCRIPT_ID = "mock-transcript-0000-0000-0000";
const FAKE_UPLOAD_URL = "https://mock.assemblyai.com/uploads/fake-audio";
const FAKE_TRANSCRIPT_TEXT =
  "Hello, this is a mocked transcript for end-to-end testing. The agent " +
  "greeted the customer and resolved their billing question with empathy " +
  "and clarity. Thank you for calling.";

// Minimal Bedrock Converse response shape matching what `ai-provider.ts`
// parses. Keep scores + sub-scores deterministic so assertions are easy.
const FAKE_BEDROCK_ANALYSIS = {
  summary: "Mocked call analysis for e2e testing. Agent resolved billing question.",
  topics: ["billing", "account management"],
  sentiment: "positive",
  performance_score: 8.5,
  sub_scores: {
    compliance: 8.0,
    customer_experience: 9.0,
    communication: 8.5,
    resolution: 8.5,
  },
  action_items: ["Follow up in 7 days to confirm resolution."],
  feedback: {
    strengths: [{ text: "Strong empathy throughout the call.", timestamp: "00:15" }],
    suggestions: [{ text: "Consider offering the loyalty discount proactively.", timestamp: "01:42" }],
  },
  flags: [],
  detected_agent_name: "Test Agent",
  call_party_type: "customer",
};

export const mockHandlers: HttpHandler[] = [
  // AssemblyAI: upload — returns a fake URL.
  http.post("https://api.assemblyai.com/v2/upload", () => {
    return HttpResponse.json({ upload_url: FAKE_UPLOAD_URL });
  }),

  // AssemblyAI: submit transcription — returns a pending transcript.
  http.post("https://api.assemblyai.com/v2/transcript", () => {
    return HttpResponse.json({
      id: FAKE_TRANSCRIPT_ID,
      status: "queued",
      audio_url: FAKE_UPLOAD_URL,
    });
  }),

  // AssemblyAI: poll transcript — always returns "completed" on first poll.
  http.get(`https://api.assemblyai.com/v2/transcript/${FAKE_TRANSCRIPT_ID}`, () => {
    return HttpResponse.json({
      id: FAKE_TRANSCRIPT_ID,
      status: "completed",
      text: FAKE_TRANSCRIPT_TEXT,
      confidence: 0.95,
      audio_duration: 120,
      words: [
        { text: "Hello", start: 0, end: 500, confidence: 0.99, speaker: "A" },
        { text: "this", start: 500, end: 700, confidence: 0.98, speaker: "A" },
        { text: "is", start: 700, end: 800, confidence: 0.99, speaker: "A" },
        { text: "a", start: 800, end: 900, confidence: 0.99, speaker: "A" },
        { text: "mocked", start: 900, end: 1300, confidence: 0.95, speaker: "A" },
        { text: "transcript", start: 1300, end: 2000, confidence: 0.95, speaker: "A" },
      ],
      utterances: [
        {
          speaker: "A",
          text: FAKE_TRANSCRIPT_TEXT.slice(0, 50),
          start: 0,
          end: 2000,
          confidence: 0.95,
          words: [],
        },
      ],
      sentiment_analysis_results: [
        { text: "Hello, this is a mocked transcript.", sentiment: "POSITIVE", confidence: 0.95, start: 0, end: 2000, speaker: "A" },
      ],
      language_code: "en",
    });
  }),

  // Bedrock Converse — return a JSON analysis wrapped in the Bedrock
  // response envelope (ai-provider.ts's parseJsonResponse handles the
  // outer shape).
  http.post(/^https:\/\/bedrock-runtime\..*\.amazonaws\.com\/model\/.*\/converse$/, () => {
    return HttpResponse.json({
      output: {
        message: {
          role: "assistant",
          content: [{ text: JSON.stringify(FAKE_BEDROCK_ANALYSIS) }],
        },
      },
      stopReason: "end_turn",
      usage: { inputTokens: 1500, outputTokens: 350, totalTokens: 1850 },
    });
  }),

  // Bedrock embeddings (Titan) — return a deterministic 256-dim vector
  // so call-clustering + semantic search can run without live creds.
  http.post(/^https:\/\/bedrock-runtime\..*\.amazonaws\.com\/model\/.*titan-embed.*\/invoke$/, () => {
    const vec = new Array(256).fill(0).map((_, i) => (i % 10) * 0.01);
    return HttpResponse.json({
      embedding: vec,
      inputTextTokenCount: 100,
    });
  }),

  // S3: accept PUT + return success. Handles audio archival when no
  // real bucket is configured. The dev server already degrades to
  // MemStorage without S3_BUCKET, but the S3 client itself may still
  // attempt to sign + call the endpoint — the mock swallows it.
  http.put(/^https:\/\/[^/]+\.s3\..*\.amazonaws\.com\/.*$/, () => {
    return new HttpResponse(null, { status: 200 });
  }),
  http.get(/^https:\/\/[^/]+\.s3\..*\.amazonaws\.com\/.*$/, () => {
    return new HttpResponse(null, { status: 200 });
  }),

  // IMDS (EC2 instance metadata) — return 404 so the AWS credentials
  // resolver falls through to env vars cleanly.
  http.get("http://169.254.169.254/latest/api/token", () => {
    return new HttpResponse(null, { status: 404 });
  }),
];

export const TEST_FIXTURES = {
  transcriptId: FAKE_TRANSCRIPT_ID,
  uploadUrl: FAKE_UPLOAD_URL,
  transcriptText: FAKE_TRANSCRIPT_TEXT,
  analysis: FAKE_BEDROCK_ANALYSIS,
};
