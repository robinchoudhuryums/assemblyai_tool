/**
 * Factory that creates the AI analysis provider (AWS Bedrock).
 */
import type { AIAnalysisProvider } from "./ai-provider";
import { BedrockProvider } from "./bedrock";
import { logger } from "./logger";

function createProvider(): AIAnalysisProvider {
  const provider = new BedrockProvider();
  if (!provider.isAvailable) {
    // A8/F07: removed the misleading "transcript-based defaults" log — Bedrock is
    // the only provider; if it's unavailable, analysis is simply skipped upstream.
    logger.warn("Bedrock AI provider not configured: set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or attach an IAM instance profile");
  }
  return provider;
}

export const aiProvider = createProvider();
