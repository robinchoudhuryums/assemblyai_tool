/**
 * Request Correlation ID
 *
 * Uses AsyncLocalStorage to propagate a unique correlation ID through
 * the entire request lifecycle — from middleware through services to
 * database calls. The ID is automatically included in all structured
 * log entries, making it possible to trace a single request across
 * all log lines without manual threading.
 *
 * Ported from ums-knowledge-reference/backend/src/utils/correlationId.ts.
 */

import { AsyncLocalStorage } from "async_hooks";

interface CorrelationContext {
  correlationId: string;
  /** Optional call ID for pipeline processing (more specific than request ID) */
  callId?: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}

export function getCallId(): string | undefined {
  return correlationStore.getStore()?.callId;
}

export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  return correlationStore.run({ correlationId: id }, fn);
}

export function setCallId(callId: string): void {
  const store = correlationStore.getStore();
  if (store) store.callId = callId;
}
