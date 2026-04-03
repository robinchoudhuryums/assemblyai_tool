/**
 * Custom OpenTelemetry span helpers for key pipeline operations.
 *
 * Creates child spans for: Bedrock AI analysis, AssemblyAI transcription,
 * RAG context fetch, embedding generation, and other expensive operations.
 * These appear as nested spans under the HTTP request span in Jaeger/Tempo/etc.
 *
 * When OTEL_ENABLED is false, these are no-ops (zero overhead).
 *
 * Ported from ums-knowledge-reference/backend/src/utils/traceSpan.ts.
 */

import { trace, Span, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("callanalyzer");

/**
 * Run an async function inside a named span.
 * Automatically records duration, sets error status on failure, and adds attributes.
 *
 * Usage:
 *   const result = await withSpan('bedrock.analyze', { model: 'sonnet' }, async (span) => {
 *     const res = await provider.analyzeCallTranscript(...);
 *     span.setAttribute('tokens.input', 1234);
 *     return res;
 *   });
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean> | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Add an event to the current active span (if any).
 * Marks milestones within a span (e.g., "transcription_complete", "ai_analysis_start").
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) span.addEvent(name, attributes);
}

/**
 * Set attributes on the current active span.
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }
  }
}
