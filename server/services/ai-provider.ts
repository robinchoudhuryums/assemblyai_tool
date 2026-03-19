/**
 * AI Analysis Provider — shared interface for AWS Bedrock (Claude).
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
  call_category: string | null;
  flags: string[];
  detected_agent_name: string | null;
}

export interface AIAnalysisProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  analyzeCallTranscript(transcriptText: string, callId: string, callCategory?: string, promptTemplate?: PromptTemplateConfig, language?: string): Promise<CallAnalysis>;
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

/**
 * For very long transcripts, keep the beginning and end (most info-dense)
 * and sample the middle to stay within reasonable token budgets.
 * Threshold: ~80K chars (~20K tokens input).
 */
function smartTruncate(text: string, maxChars = 80000): string {
  if (text.length <= maxChars) return text;

  const headSize = Math.floor(maxChars * 0.35);
  const tailSize = Math.floor(maxChars * 0.35);
  const midSize = maxChars - headSize - tailSize - 200;
  const midStart = Math.floor((text.length - midSize) / 2);

  return [
    text.slice(0, headSize),
    `\n\n[... ${((text.length - maxChars) / 1000).toFixed(0)}K characters omitted from mid-call transitions ...]\n\n`,
    text.slice(midStart, midStart + midSize),
    "\n\n[... continued ...]\n\n",
    text.slice(-tailSize),
  ].join("");
}

export function buildAnalysisPrompt(transcriptText: string, callCategory?: string, template?: PromptTemplateConfig, language?: string): string {
  const processedTranscript = smartTruncate(transcriptText);

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

  // Language instruction for non-English analysis
  let languageInstruction = "";
  if (language && language !== "en") {
    const languageNames: Record<string, string> = { es: "Spanish", fr: "French", pt: "Portuguese", de: "German" };
    const langName = languageNames[language] || language;
    languageInstruction = `\n\nIMPORTANT: The transcript is in ${langName}. Analyze the call in ${langName} and write ALL response content (summary, topics, action_items, feedback strengths/suggestions) in ${langName}. Keep JSON field names in English but all values should be in ${langName}.`;
  }

  return `You are analyzing a call transcript for a medical supply company. Analyze the ENTIRE transcript from beginning to end — reference moments from the beginning, middle, AND end. Do not skip or summarize sections.${languageInstruction}
${categoryContext}
TRANSCRIPT:
${processedTranscript}

Respond with ONLY valid JSON (no markdown, no code fences):
{"summary":"...","topics":["..."],"sentiment":"positive|neutral|negative","sentiment_score":0.0,"performance_score":0.0,"sub_scores":{"compliance":0.0,"customer_experience":0.0,"communication":0.0,"resolution":0.0},"action_items":["..."],"feedback":{"strengths":[{"text":"...","timestamp":"MM:SS"}],"suggestions":[{"text":"...","timestamp":"MM:SS"}]},"call_party_type":"customer|insurance|medical_facility|medicare|vendor|internal|other","call_category":"inbound|outbound|internal|vendor","flags":[],"detected_agent_name":null}

Guidelines:
- sentiment_score: 0.0-1.0 (1.0 = most positive)
- performance_score: 0.0-10.0 (overall weighted score)
- sub_scores (each 0.0-10.0): compliance (procedures, HIPAA, policies), customer_experience (empathy, patience, tone), communication (clarity, listening, completeness), resolution (issue resolution effectiveness)
${evaluationCriteria}${scoringSection}${phrasesSection}${additionalSection}
- For EACH strength/suggestion, include approximate timestamp (MM:SS) of the referenced moment
- 2-4 concrete, actionable action items
- Topics: specific (e.g. "order tracking", "billing dispute"), not generic
- call_party_type: "customer" (patients), "insurance" (reps), "medical_facility" (clinics/hospitals), "medicare" (1-800-MEDICARE), "vendor", "internal" (coworkers), "other"
- call_category: Classify this call as one of: "inbound" (customer/patient called in), "outbound" (employee called out), "internal" (between coworkers/departments), "vendor" (with external vendor/partner). Base this on conversation context, topic, and participants.
- detected_agent_name: Agent's name if clearly stated (e.g. "Hi, my name is Sarah"). Return null if uncertain. Only the agent's name, not the customer's.
- flags: "medicare_call" ONLY if the caller is from 1-800-MEDICARE or CMS (Centers for Medicare & Medicaid Services) — do NOT flag calls where Medicare is merely mentioned as an insurance type (e.g. "Aetna Medicare", "United Healthcare Medicare Advantage" are NOT medicare_call flags). "low_score" if performance ≤2.0, "exceptional_call" if ≥9.0 with outstanding service, "agent_misconduct:<description>" for serious misconduct (abusive language, hanging up, HIPAA violations, etc.)`;
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
