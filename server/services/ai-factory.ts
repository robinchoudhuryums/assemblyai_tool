/**
 * Factory that creates the AI analysis provider (AWS Bedrock).
 */
import type { AIAnalysisProvider } from "./ai-provider";
import { BedrockProvider } from "./bedrock";

function createProvider(): AIAnalysisProvider {
  const provider = new BedrockProvider();
  if (provider.isAvailable) return provider;

  console.warn("No AI analysis provider configured. AWS credentials are required for Bedrock. Analysis will use transcript-based defaults.");
  return provider;
}

export const aiProvider = createProvider();
