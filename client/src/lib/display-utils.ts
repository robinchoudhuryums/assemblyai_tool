/**
 * Shared utility for safely converting AI response values to display strings.
 * AI models (Bedrock) may return objects where strings are expected — this
 * function handles all cases consistently across the frontend.
 */
export function toDisplayString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return sanitizeDisplayString(val);
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.text === "string") return sanitizeDisplayString(obj.text);
    if (typeof obj.name === "string") return sanitizeDisplayString(obj.name);
    if (typeof obj.task === "string") return sanitizeDisplayString(obj.task);
    if (typeof obj.label === "string") return sanitizeDisplayString(obj.label);
    if (typeof obj.description === "string") return sanitizeDisplayString(obj.description);
    return JSON.stringify(val);
  }
  return String(val);
}

/**
 * Sanitize AI-generated strings to prevent XSS.
 *
 * Defense-in-depth: React already escapes JSX text children, but this protects against:
 * 1. Usage in contexts where React doesn't escape (dangerouslySetInnerHTML, attribute values)
 * 2. HTML entity bypasses (&#x3C;script&#x3E;)
 * 3. Null bytes and control characters that can confuse parsers
 *
 * Strategy: Strip HTML tags, decode entities, strip again, then remove dangerous patterns.
 */
function sanitizeDisplayString(str: string): string {
  let clean = str;

  // Remove null bytes and control characters (except whitespace)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Strip HTML tags (multi-pass to catch nested/encoded tags)
  clean = clean.replace(/<[^>]*>/g, "");

  // Decode common HTML entities that could hide tags
  clean = clean
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");

  // Strip tags again after entity decoding
  clean = clean.replace(/<[^>]*>/g, "");

  // Remove javascript: and data: URI patterns (case-insensitive, whitespace-tolerant)
  clean = clean.replace(/\bjavascript\s*:/gi, "");
  clean = clean.replace(/\bdata\s*:\s*text\/html/gi, "");

  // Remove event handler patterns (onerror=, onclick=, etc.)
  clean = clean.replace(/\bon\w+\s*=/gi, "");

  return clean;
}

/**
 * Extract a user-friendly error message from API error strings.
 * Strips the HTTP status code prefix (e.g. "401: ...") that throwIfResNotOk adds.
 */
export function extractErrorMessage(error: unknown): string {
  if (!error) return "An unexpected error occurred.";
  const msg = error instanceof Error ? error.message : String(error);
  // Strip "NNN: " prefix from throwIfResNotOk format
  return msg.replace(/^\d{3}:\s*/, "");
}
