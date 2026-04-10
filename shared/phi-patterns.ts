/**
 * Shared PHI redaction patterns for HIPAA compliance.
 *
 * Mirrors server/services/phi-redactor.ts so the same regex set is applied
 * before any text leaves the client (Sentry events, error boundaries, etc.).
 *
 * Targeted HIPAA identifiers that commonly appear in free text:
 *   - SSNs
 *   - Phone numbers
 *   - Email addresses
 *   - Dates of birth (multiple formats)
 *   - Medical Record Numbers (MRN)
 *   - Medicare/Medicaid Beneficiary IDs
 *   - Street addresses, ZIPs
 *   - Health plan / account numbers
 *   - Patient names (with clinical context prefixes)
 *
 * This module is intentionally pure (no Node or browser-specific imports)
 * so it can be loaded from both `client/src` and `server/`.
 */

// SSN: 123-45-6789, 123 45 6789, 123456789
export const SSN_PATTERN = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g;

// Phone numbers, with lookbehind/lookahead to avoid matching inside longer
// digit runs (claim IDs, order numbers).
export const PHONE_PATTERN = /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g;

// Email addresses
export const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// DOB with keyword context: DOB 01/15/1952, born on 01-15-1952
export const DOB_PATTERN = /(?:DOB|d\.?o\.?b\.?|date\s+of\s+birth|born\s+on|birthdate)[:\s]*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/gi;

// Natural-language DOB: "born in January 1952", "birth date March 3, 1960"
export const DOB_NATURAL_PATTERN = /(?:born\s+(?:in\s+)?|birth\s*date[:\s]*)(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+\d{1,2},?)?\s+\d{2,4}\b/gi;

// Standalone dates that look like birthdates (MM/DD/YYYY 1900-2099)
export const DATE_PATTERN = /\b(?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01])[/\-](?:19\d{2}|20\d{2})\b/g;

// Medical Record Number / patient ID with keyword
export const MRN_PATTERN = /(?:MRN|medical\s+record(?:\s+number)?|patient\s+(?:id|number|#))[:\s#]*(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,15}/gi;

// Medicare Beneficiary Identifier (MBI)
export const MBI_PATTERN = /\b[1-9][A-Za-z]\w{2}[-\s]?[A-Za-z]\w{2}[-\s]?\w{4}\b/g;

// Medicaid ID with keyword context
export const MEDICAID_PATTERN = /(?:medicaid|medi-cal)\s*(?:id|#|number)?[:\s]*[A-Z0-9]{6,14}/gi;

// Street addresses
export const ADDRESS_PATTERN = /\b\d{1,6}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Ct|Court|Way|Pl(?:ace)?|Cir(?:cle)?)\b\.?/gi;

// ZIP codes with state or "zip" context
export const ZIP_PATTERN = /(?:(?:[A-Z]{2}\s+)|(?:zip(?:\s*code)?[:\s]*))(\d{5}(?:-\d{4})?)\b/gi;

// Health plan / account / policy / group / subscriber numbers
export const PLAN_ACCOUNT_PATTERN = /(?:(?:health\s*)?plan|account|policy|group|subscriber|certificate)\s*(?:#|number|num|no\.?)?[:\s]*([A-Z0-9]{5,20})\b/gi;

// Names with clinical-context prefix
export const NAME_PREFIX_PATTERN = /(?:patient|pt|member|beneficiary|claimant|insured|subscriber|enrollee)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/gi;

// Title + name: Mr./Mrs./Ms./Dr. Firstname Lastname
export const TITLE_NAME_PATTERN = /(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;

interface PatternEntry {
  pattern: RegExp;
  label: string;
}

// Order matters: more specific patterns first, broader ones last.
const PATTERN_LIST: PatternEntry[] = [
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
 * Redact PHI from a single string.
 */
export function redactPhiText(text: string): string {
  if (!text) return text;
  let result = text;
  for (const { pattern, label } of PATTERN_LIST) {
    result = result.replace(pattern, `[REDACTED-${label}]`);
  }
  return result;
}

/**
 * Recursively scrub PHI from any value (string, array, object).
 *
 * - Strings are passed through redactPhiText.
 * - Arrays and plain objects are walked.
 * - Cycles are tracked via WeakSet.
 * - Depth and string length are bounded to prevent runaway scrubs.
 *
 * Errors and other non-plain objects are stringified via their `toString`.
 */
const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 10_000;

export function deepScrubPhi<T>(value: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return value;

  if (typeof value === "string") {
    const truncated = value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
    return redactPhiText(truncated) as unknown as T;
  }

  if (typeof value !== "object") return value;

  // Object / array
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => deepScrubPhi(item, depth + 1, seen)) as unknown as T;
  }

  // Plain object — copy with scrubbed values. Skip non-enumerable / prototype keys.
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = deepScrubPhi((value as Record<string, unknown>)[key], depth + 1, seen);
  }
  return result as unknown as T;
}
