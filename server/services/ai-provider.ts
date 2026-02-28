/**
 * AI Analysis Provider — shared interface and factory.
 *
 * Supports multiple backends:
 *   AI_PROVIDER=gemini   — Google AI Studio or Vertex AI (default)
 *   AI_PROVIDER=bedrock  — AWS Bedrock with Claude
 *
 * All providers implement the same interface and return identical output shapes.
 */

export interface CallAnalysis {
  summary: string;
  topics: string[];
  sentiment: string;
  sentiment_score: number;
  performance_score: number;
  sub_scores: {
    compliance: number;
    customer_experience: number;
    communication: number;
    resolution: number;
  };
  action_items: string[];
  feedback: {
    strengths: Array<string | { text: string; timestamp?: string }>;
    suggestions: Array<string | { text: string; timestamp?: string }>;
  };
  call_party_type: string;
  flags: string[];
  detected_agent_name: string | null;
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: PromptTemplateConfig): Promise<CallAnalysis>;
  generateText?(prompt: string): Promise<string>;
}

/**
 * Build a prompt for generating a narrative agent profile summary.
 */
export function buildAgentSummaryPrompt(data: {
  name: string;
  role?: string;
  totalCalls: number;
  avgScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  topStrengths: Array<{ text: string; count: number }>;
  topSuggestions: Array<{ text: string; count: number }>;
  commonTopics: Array<{ text: string; count: number }>;
  dateRange: string;
}): string {
  const strengthsList = data.topStrengths.map(s => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const suggestionsList = data.topSuggestions.map(s => `- "${s.text}" (observed ${s.count} times)`).join("\n");
  const topicsList = data.commonTopics.map(t => `- ${t.text} (${t.count} calls)`).join("\n");

  return `You are an HR/quality assurance analyst for a medical supply company. Write a professional performance summary for the following call center agent based on aggregated data from their analyzed calls.

AGENT: ${data.name}
DEPARTMENT: ${data.role || "N/A"}
PERIOD: ${data.dateRange}
TOTAL CALLS ANALYZED: ${data.totalCalls}

PERFORMANCE SCORES:
- Average: ${data.avgScore?.toFixed(1) ?? "N/A"}/10
- Best: ${data.highScore?.toFixed(1) ?? "N/A"}/10
- Lowest: ${data.lowScore?.toFixed(1) ?? "N/A"}/10

SENTIMENT BREAKDOWN:
- Positive: ${data.sentimentBreakdown.positive}
- Neutral: ${data.sentimentBreakdown.neutral}
- Negative: ${data.sentimentBreakdown.negative}

RECURRING STRENGTHS:
${strengthsList || "None identified"}

RECURRING AREAS FOR IMPROVEMENT:
${suggestionsList || "None identified"}

COMMON CALL TOPICS:
${topicsList || "Various"}

Write a concise (3-4 paragraph) professional narrative that:
1. Summarizes overall performance and trends
2. Highlights consistent strengths with specific examples from the data
3. Identifies key areas for improvement with actionable recommendations
4. Provides a brief outlook or coaching recommendation

Use a professional but supportive tone appropriate for a performance review. Do NOT use markdown formatting, bullet points, or headers — write in plain paragraph form.`;
}

const CATEGORY_CONTEXT: Record<string, string> = {
  inbound: "This is an INBOUND call — a customer or patient called into the company. One speaker is the customer/patient and the other is the company employee/agent.",
  outbound: "This is an OUTBOUND call — the company employee called a customer or patient. One speaker is the employee/agent and the other is the customer/patient.",
  internal: "This is an INTERNAL call — both speakers are coworkers or employees within the same company. Evaluate collaboration, communication clarity, and productivity rather than customer service metrics.",
  vendor: "This is a VENDOR/PARTNER call — the employee is speaking with an external vendor or business partner. Evaluate negotiation, clarity, and professionalism.",
};

export interface PromptTemplateConfig {
  evaluationCriteria?: string;
  requiredPhrases?: Array<{ phrase: string; label: string; severity: string }>;
  scoringWeights?: { compliance: number; customerExperience: number; communication: number; resolution: number };
  additionalInstructions?: string;
}

export function buildAnalysisPrompt(transcriptText: string, callCategory?: string, template?: PromptTemplateConfig): string {
  const categoryContext = callCategory && CATEGORY_CONTEXT[callCategory]
    ? `\nCALL CONTEXT:\n${CATEGORY_CONTEXT[callCategory]}\n`
    : "";

  // Use custom evaluation criteria from template, or defaults
  let evaluationCriteria: string;
  if (template?.evaluationCriteria) {
    evaluationCriteria = `- EVALUATION CRITERIA (use these to guide your scoring):\n${template.evaluationCriteria}`;
  } else if (callCategory === "internal") {
    evaluationCriteria = "- Evaluate on: communication clarity, collaboration effectiveness, action item follow-through, and productivity";
  } else {
    evaluationCriteria = "- Evaluate the agent on: professionalism, product knowledge, empathy, problem resolution, and compliance with medical supply protocols";
  }

  // Build scoring weights section
  let scoringSection = "";
  if (template?.scoringWeights) {
    const w = template.scoringWeights;
    scoringSection = `\n- SCORING WEIGHTS: Compliance (${w.compliance}%), Customer Experience (${w.customerExperience}%), Communication (${w.communication}%), Resolution (${w.resolution}%). Weight your performance_score accordingly.`;
  }

  // Build required phrases check
  let phrasesSection = "";
  if (template?.requiredPhrases && template.requiredPhrases.length > 0) {
    const required = template.requiredPhrases.filter(p => p.severity === "required");
    const recommended = template.requiredPhrases.filter(p => p.severity === "recommended");
    if (required.length > 0) {
      phrasesSection += `\n- REQUIRED PHRASES: The agent MUST say something equivalent to the following. Flag "missing_required_phrase:<label>" for each missing phrase:\n`;
      phrasesSection += required.map(p => `  * "${p.phrase}" (${p.label})`).join("\n");
    }
    if (recommended.length > 0) {
      phrasesSection += `\n- RECOMMENDED PHRASES: The agent SHOULD say something similar to these. Note in suggestions if missing:\n`;
      phrasesSection += recommended.map(p => `  * "${p.phrase}" (${p.label})`).join("\n");
    }
  }

  // Build additional instructions
  let additionalSection = "";
  if (template?.additionalInstructions) {
    additionalSection = `\n- ADDITIONAL INSTRUCTIONS:\n${template.additionalInstructions}`;
  }

  return `You are analyzing a call transcript for a medical supply company. Analyze the ENTIRE transcript from beginning to end — do not skip or summarize any sections. Every part of the conversation may contain important details that affect scoring.
${categoryContext}
TRANSCRIPT:
${transcriptText}

Respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "summary": "A concise one-paragraph summary of what happened in the call",
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "sentiment_score": 0.0,
  "performance_score": 0.0,
  "sub_scores": {
    "compliance": 0.0,
    "customer_experience": 0.0,
    "communication": 0.0,
    "resolution": 0.0
  },
  "action_items": ["action1", "action2"],
  "feedback": {
    "strengths": [{"text": "Description of strength referencing a specific moment", "timestamp": "MM:SS"}],
    "suggestions": [{"text": "Description of suggestion referencing a specific moment", "timestamp": "MM:SS"}]
  },
  "call_party_type": "customer|insurance|medical_facility|medicare|vendor|internal|other",
  "flags": [],
  "detected_agent_name": null
}

Guidelines:
- IMPORTANT: You MUST analyze the ENTIRE transcript. Reference moments from the beginning, middle, AND end of the call to demonstrate complete coverage. Do not focus only on the first portion.
- sentiment_score: 0.0 to 1.0 (1.0 = most positive)
- performance_score: 0.0 to 10.0 (10.0 = best) — this is the overall weighted score
- sub_scores: Rate each dimension 0.0-10.0:
  * compliance: Adherence to required procedures, scripts, disclaimers, HIPAA, and company policies
  * customer_experience: Empathy, patience, tone, making the caller feel heard and valued
  * communication: Clarity, articulation, active listening, providing complete information
  * resolution: Effectiveness at resolving the caller's issue or advancing toward resolution
${evaluationCriteria}${scoringSection}${phrasesSection}${additionalSection}
- For EACH strength and suggestion, include the approximate timestamp (MM:SS format) of the moment in the call you are referencing. Use the timestamps from the transcript to determine the time.
- Include 2-4 action items that are concrete and actionable
- Topics should be specific (e.g. "order tracking", "billing dispute") not generic
- call_party_type: Classify who the agent is speaking with. Use "customer" for general patients/customers, "insurance" for insurance company representatives, "medical_facility" for hospitals/clinics/doctors offices, "medicare" for 1-800-MEDICARE or Medicare representatives, "vendor" for vendors/suppliers, "internal" for coworkers, or "other" if unclear.
- detected_agent_name: If the agent identifies themselves by name during the call (e.g. "Hi, my name is Sarah" or "This is John from..."), provide ONLY their first name or full name exactly as spoken. If no name is clearly stated, return null. Only include names you are confident belong to the agent (not the customer).
- flags: An array of flag strings. Add "medicare_call" if the call involves 1-800-MEDICARE or a Medicare representative. Add "low_score" if the performance_score is 2.0 or below. Add "exceptional_call" if the performance_score is 9.0 or above AND the agent demonstrated outstanding customer service, empathy, problem-solving, or went above and beyond. Add "agent_misconduct" if the agent displays any of: abusive language toward the caller, hanging up on the caller, refusing to help, making false promises, HIPAA violations, or other serious professional misconduct. Describe the misconduct briefly in the flag like "agent_misconduct:hung up on caller".`;
}

/**
 * Parse a JSON object from model output, handling markdown fences and extra text.
 */
export function parseJsonResponse(text: string, callId: string): CallAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[${callId}] AI response was not parseable JSON:`, text.slice(0, 200));
    throw new Error("AI response did not contain valid JSON");
  }

  try {
    return JSON.parse(jsonMatch[0]) as CallAnalysis;
  } catch (parseError) {
    console.warn(`[${callId}] JSON parse failed:`, (parseError as Error).message, text.slice(0, 300));
    throw new Error("AI response contained malformed JSON");
  }
}
