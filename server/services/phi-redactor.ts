/**
 * PHI Redaction Utility
 *
 * Detects and redacts potential Protected Health Information (PHI) from text
 * before it is written to audit logs, error logs, or API responses.
 *
 * CONSOLIDATED (F31): Imports pattern definitions from shared/phi-patterns.ts
 * — the single source of truth for all 14 HIPAA identifier regexes. This
 * eliminates the drift risk where a new pattern added to one file but not the
 * other would leave PHI unredacted on one side (server audit logs vs. client
 * Sentry events).
 *
 * This module adds server-specific functionality on top of the shared patterns:
 * - RedactionResult with count tracking
 * - deepRedactPhi for nested object traversal
 * - Label format: [SSN] (server audit) vs [REDACTED-SSN] (client Sentry)
 */

import {
  SSN_PATTERN,
  PHONE_PATTERN,
  EMAIL_PATTERN,
  DOB_PATTERN,
  DOB_NATURAL_PATTERN,
  DATE_PATTERN,
  MRN_PATTERN,
  MBI_PATTERN,
  MEDICAID_PATTERN,
  ADDRESS_PATTERN,
  ZIP_PATTERN,
  PLAN_ACCOUNT_PATTERN,
  NAME_PREFIX_PATTERN,
  TITLE_NAME_PATTERN,
} from "@shared/phi-patterns";

export interface RedactionResult {
  text: string;
  redactionCount: number;
}

// Pattern application order (specific → broad) matches shared/phi-patterns.ts PATTERN_LIST
const SERVER_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: SSN_PATTERN, label: "SSN" },
  { pattern: DOB_PATTERN, label: "DOB" },
  { pattern: DOB_NATURAL_PATTERN, label: "DOB" },
  { pattern: DATE_PATTERN, label: "DATE" },
  { pattern: MRN_PATTERN, label: "MRN" },
  { pattern: MBI_PATTERN, label: "MBI" },
  { pattern: MEDICAID_PATTERN, label: "MEDICAID-ID" },
  { pattern: EMAIL_PATTERN, label: "EMAIL" },
  { pattern: PHONE_PATTERN, label: "PHONE" },
  { pattern: ADDRESS_PATTERN, label: "ADDRESS" },
  { pattern: ZIP_PATTERN, label: "ZIP" },
  { pattern: PLAN_ACCOUNT_PATTERN, label: "PLAN-ID" },
  { pattern: NAME_PREFIX_PATTERN, label: "NAME" },
  { pattern: TITLE_NAME_PATTERN, label: "NAME" },
];

/**
 * Redact potential PHI from a text string.
 * Returns the redacted text and a count of redactions made.
 */
export function redactPhi(text: string): RedactionResult {
  if (!text) return { text, redactionCount: 0 };

  let redactionCount = 0;
  let result = text;

  for (const { pattern, label } of SERVER_PATTERNS) {
    const matches = result.match(pattern);
    if (matches) {
      redactionCount += matches.length;
      result = result.replace(pattern, `[${label}]`);
    }
  }

  return { text: result, redactionCount };
}

/**
 * Deep redact PHI from an object. Traverses all string values in nested
 * objects and arrays. Returns the redacted object and total redaction count.
 */
export function deepRedactPhi<T>(obj: T): { redacted: T; totalRedactions: number } {
  if (obj === null || obj === undefined) return { redacted: obj, totalRedactions: 0 };

  if (typeof obj === "string") {
    const result = redactPhi(obj);
    return { redacted: result.text as unknown as T, totalRedactions: result.redactionCount };
  }

  if (Array.isArray(obj)) {
    let total = 0;
    const arr = obj.map(item => {
      const { redacted, totalRedactions } = deepRedactPhi(item);
      total += totalRedactions;
      return redacted;
    });
    return { redacted: arr as unknown as T, totalRedactions: total };
  }

  if (typeof obj === "object") {
    let total = 0;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const { redacted, totalRedactions } = deepRedactPhi(value);
      result[key] = redacted;
      total += totalRedactions;
    }
    return { redacted: result as T, totalRedactions: total };
  }

  return { redacted: obj, totalRedactions: 0 };
}
