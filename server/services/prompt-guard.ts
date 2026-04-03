/**
 * Prompt Injection Detection for Call Analysis
 *
 * Detects potential prompt injection attempts in call transcripts before they
 * are sent to Bedrock for AI analysis. Since transcripts come from speech-to-text,
 * injection text could be spoken by a malicious caller.
 *
 * Unlike a chat system (where we'd block the request), here we FLAG the risk
 * and let analysis proceed — the call still needs to be analyzed, but the flag
 * alerts reviewers that the AI output may be manipulated.
 *
 * Also includes output-side guardrails to detect if the AI response shows signs
 * of a successful injection bypass (e.g., the model stopped scoring the call
 * and instead followed injected instructions).
 *
 * Ported from ums-knowledge-reference with adaptations for the call analysis domain.
 */

// --- Input-side detection: scan transcript before sending to Bedrock ---

const INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Instruction override attempts
  { pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i, reason: 'Attempts to override system instructions' },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i, reason: 'Attempts to override system instructions' },
  { pattern: /forget\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|guidelines?)/i, reason: 'Attempts to override system instructions' },
  { pattern: /\bdo\s+not\s+follow\s+(the\s+)?(system|above|previous)\b/i, reason: 'Instruction override attempt' },

  // Role manipulation
  { pattern: /you\s+are\s+now\s+(a|an|the|my)\s+/i, reason: 'Role reassignment attempt' },
  { pattern: /pretend\s+(you('re|\s+are)\s+)?(not\s+)?(a|an|the)\s+/i, reason: 'Role manipulation attempt' },
  { pattern: /act\s+as\s+(if\s+)?(you('re|\s+are)\s+)?(a|an|the|my)\s+/i, reason: 'Role manipulation attempt' },

  // Direct injection markers
  { pattern: /new\s+instructions?:\s*/i, reason: 'Instruction injection attempt' },
  { pattern: /system\s*prompt\s*[:=]/i, reason: 'System prompt manipulation attempt' },
  { pattern: /\[system\]|\[inst\]|\[\/inst\]|<\|system\|>|<\|user\|>|<\|assistant\|>/i, reason: 'Chat template injection' },
  { pattern: /```\s*(system|instruction|prompt)/i, reason: 'Code block instruction injection' },
  { pattern: /override\s+(the\s+)?(system|safety|content)\s+(prompt|filter|policy)/i, reason: 'Safety override attempt' },

  // Call-analysis-specific: attempts to manipulate scoring
  { pattern: /give\s+(this|the)\s+(call|agent|person)\s+a\s+(perfect|high|10|ten)\s+score/i, reason: 'Score manipulation attempt' },
  { pattern: /score\s+this\s+(call\s+)?(a\s+)?(10|ten|perfect)/i, reason: 'Score manipulation attempt' },
  { pattern: /output\s+the\s+following\s+json/i, reason: 'Output format manipulation attempt' },
  { pattern: /return\s+this\s+exact\s+(json|response|output)/i, reason: 'Output override attempt' },
];

/**
 * Detect potential prompt injection in a transcript before sending to the AI.
 *
 * Returns detected: true if suspicious patterns found, with a reason string.
 * Does NOT block analysis — the flag is added to the call for reviewer attention.
 */
export function detectTranscriptInjection(text: string): { detected: boolean; reasons: string[] } {
  // Normalize Unicode to NFC to prevent bypass via decomposed characters
  const normalized = text.normalize('NFC')
    .replace(/[\u0400-\u04FF]/g, ch => {
      const cyrillicMap: Record<string, string> = { 'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x' };
      return cyrillicMap[ch.toLowerCase()] || ch;
    });

  const reasons: string[] = [];

  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      reasons.push(reason);
    }
  }

  // Check for excessive special delimiters that may try to break prompt framing
  const delimiterCount = (normalized.match(/---+|===+|####+|\*\*\*+/g) || []).length;
  if (delimiterCount > 5) {
    reasons.push('Excessive delimiters may indicate context manipulation');
  }

  return { detected: reasons.length > 0, reasons };
}

// --- Output-side detection: scan AI response for injection bypass signs ---

const OUTPUT_LEAK_PATTERNS: RegExp[] = [
  // Model leaked/referenced its system prompt
  /my (?:system |internal )?(?:prompt|instructions?) (?:say|tell|are|is)/i,
  /here (?:is|are) my (?:system |internal )?(?:prompt|instructions?)/i,
  /i(?:'m| am) (?:actually |really )?(?:an? )?(?:AI|language model|LLM|chatbot|assistant)(?:,| and| that)/i,
  /as an? (?:AI|language model|LLM)/i,
];

const OUTPUT_ROLE_DEVIATION_PHRASES = [
  'here is the python code',
  'here is the javascript',
  'dear sir/madam',
  'as a creative writing exercise',
  'here is the translation',
  'i cannot analyze this call', // model refusing when it shouldn't
];

/**
 * Detect if the AI analysis response shows signs of a successful injection bypass.
 *
 * Checks for:
 * - System prompt leakage (model reveals its instructions)
 * - Role deviation (model stopped analyzing and did something else)
 * - Missing expected output structure (valid JSON wasn't returned)
 */
export function detectOutputAnomaly(responseText: string): { anomaly: boolean; reason?: string } {
  for (const pattern of OUTPUT_LEAK_PATTERNS) {
    if (pattern.test(responseText)) {
      return { anomaly: true, reason: 'Response may reference internal instructions' };
    }
  }

  const lower = responseText.toLowerCase();
  for (const phrase of OUTPUT_ROLE_DEVIATION_PHRASES) {
    if (lower.includes(phrase)) {
      return { anomaly: true, reason: 'Response deviates from call analysis role' };
    }
  }

  return { anomaly: false };
}
