/**
 * Factory that selects the AI analysis provider based on configuration.
 *
 * Priority:
 *   1. AI_PROVIDER env var (explicit choice: "gemini" or "bedrock")
 *   2. Auto-detect based on available credentials
 */
import type { AIAnalysisProvider } from "./ai-provider";
import { GeminiProvider } from "./gemini";
import { BedrockProvider } from "./bedrock";

function createProvider(): AIAnalysisProvider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();

  if (explicit === "bedrock") {
    const provider = new BedrockProvider();
    if (provider.isAvailable) return provider;
    console.warn("AI_PROVIDER=bedrock but AWS credentials missing. Falling back to Gemini.");
  }

  if (explicit === "gemini" || !explicit) {
    const gemini = new GeminiProvider();
    if (gemini.isAvailable) return gemini;
  }

  // Auto-detect: try Bedrock if Gemini wasn't available
  if (!explicit) {
    const bedrock = new BedrockProvider();
    if (bedrock.isAvailable) return bedrock;
  }

  // No provider available — return a Gemini stub (isAvailable = false)
  console.warn("No AI analysis provider configured. Analysis will use transcript-based defaults.");
  return new GeminiProvider();
}

export const aiProvider = createProvider();
