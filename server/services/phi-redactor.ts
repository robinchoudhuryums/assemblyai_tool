/**
 * PHI Redaction Utility
 *
 * Detects and redacts potential Protected Health Information (PHI) from text
 * before it is written to audit logs, error logs, or API responses.
 *
 * Targets the 18 HIPAA identifiers that commonly appear in free text:
 *   - SSNs
 *   - Phone numbers
 *   - Email addresses
 *   - Dates of birth (multiple formats)
 *   - Medical Record Numbers (MRN)
 *   - Medicare/Medicaid Beneficiary IDs
 *   - Street addresses
 *   - Health plan/account numbers
 *   - Patient names (with clinical context prefixes)
 *
 * This is a defense-in-depth measure. It does NOT replace staff training
 * on avoiding PHI. Some PHI will inevitably slip through regex.
 *
 * Ported from ums-knowledge-reference/backend/src/utils/phiRedactor.ts.
 */

// --- PHI Patterns (ordered: specific first, broad last) ---

// SSN patterns: 123-45-6789, 123 45 6789, 123456789
const SSN_PATTERN = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g;

// Phone numbers: (123) 456-7890, 123-456-7890, 123.456.7890, 1234567890
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

// Email addresses
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// DOB with keyword context: DOB 01/15/1952, born on 01-15-1952
const DOB_PATTERN = /(?:DOB|d\.?o\.?b\.?|date\s+of\s+birth|born\s+on|birthdate)[:\s]*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/gi;

// Natural language DOB: "born in January 1952", "birth date March 3, 1960"
const DOB_NATURAL_PATTERN = /(?:born\s+(?:in\s+)?|birth\s*date[:\s]*)(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}?,?\s*\d{2,4}/gi;

// Standalone dates that look like birthdates (MM/DD/YYYY with year before 2010)
const DATE_PATTERN = /\b(?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01])[/\-](?:19\d{2}|200\d)\b/g;

// MRN / Medical Record Number: require at least one digit
const MRN_PATTERN = /(?:MRN|medical\s+record(?:\s+number)?|patient\s+(?:id|number|#))[:\s#]*(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,15}/gi;

// Medicare Beneficiary Identifier (MBI): 1AN9-AA0-AA00 format
const MBI_PATTERN = /\b[1-9][A-Za-z]\w{2}[-\s]?[A-Za-z]\w{2}[-\s]?\w{4}\b/g;

// Medicaid ID: varies by state, 8-12 digits with context
const MEDICAID_PATTERN = /(?:medicaid|medi-cal)\s*(?:id|#|number)?[:\s]*[A-Z0-9]{6,14}/gi;

// Street addresses: number + street name
const ADDRESS_PATTERN = /\b\d{1,6}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Ct|Court|Way|Pl(?:ace)?|Cir(?:cle)?)\b\.?/gi;

// ZIP codes with context (state abbreviation or "zip")
const ZIP_PATTERN = /(?:(?:[A-Z]{2}\s+)|(?:zip(?:\s*code)?[:\s]*))(\d{5}(?:-\d{4})?)\b/gi;

// Health plan / account numbers with clinical context
const PLAN_ACCOUNT_PATTERN = /(?:(?:health\s*)?plan|account|policy|group|subscriber|certificate)\s*(?:#|number|num|no\.?)?[:\s]*([A-Z0-9]{5,20})\b/gi;

// Names with clinical context
const NAME_PREFIX_PATTERN = /(?:patient|pt|member|beneficiary|claimant|insured|subscriber|enrollee)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/gi;

// "Mr./Mrs./Ms./Dr. Firstname Lastname"
const TITLE_NAME_PATTERN = /(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;

export interface RedactionResult {
  text: string;
  redactionCount: number;
}

/**
 * Redact potential PHI from a text string.
 * Returns the redacted text and a count of redactions made.
 */
export function redactPhi(text: string): RedactionResult {
  if (!text) return { text, redactionCount: 0 };

  let redactionCount = 0;
  let result = text;

  const applyPattern = (pattern: RegExp, label: string): void => {
    const matches = result.match(pattern);
    if (matches) {
      redactionCount += matches.length;
      result = result.replace(pattern, `[${label}]`);
    }
  };

  // Order matters: more specific patterns first, then broader ones

  applyPattern(SSN_PATTERN, "SSN");
  applyPattern(DOB_PATTERN, "DOB");
  applyPattern(DOB_NATURAL_PATTERN, "DOB");
  applyPattern(DATE_PATTERN, "DATE");
  applyPattern(MRN_PATTERN, "MRN");
  applyPattern(MBI_PATTERN, "MBI");
  applyPattern(MEDICAID_PATTERN, "MEDICAID-ID");
  applyPattern(EMAIL_PATTERN, "EMAIL");
  applyPattern(PHONE_PATTERN, "PHONE");
  applyPattern(ADDRESS_PATTERN, "ADDRESS");
  applyPattern(ZIP_PATTERN, "ZIP");
  applyPattern(PLAN_ACCOUNT_PATTERN, "PLAN-ID");
  applyPattern(NAME_PREFIX_PATTERN, "NAME");
  applyPattern(TITLE_NAME_PATTERN, "NAME");

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
