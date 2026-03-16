/**
 * Shared utility for safely converting AI response values to display strings.
 * AI models (Bedrock) may return objects where strings are expected — this
 * function handles all cases consistently across the frontend.
 */
export function toDisplayString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.name === "string") return obj.name;
    if (typeof obj.task === "string") return obj.task;
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.description === "string") return obj.description;
    return JSON.stringify(val);
  }
  return String(val);
}
