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
 * Strip HTML tags from AI-generated strings to prevent XSS when rendered
 * via dangerouslySetInnerHTML or in contexts where React doesn't escape.
 */
function sanitizeDisplayString(str: string): string {
  return str.replace(/<[^>]*>/g, "");
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
