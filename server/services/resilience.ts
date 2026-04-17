/**
 * Resilience utilities for external service calls.
 *
 * - CircuitBreaker: prevents cascading failures when a service is down.
 *   After N consecutive failures, the circuit opens and rejects calls immediately
 *   for a cooldown period. After the cooldown, one test call is allowed through
 *   (half-open). If it succeeds, the circuit closes; if it fails, it re-opens.
 *
 * (A15: withRetry was removed as dead code — zero callers in production.)
 *
 * Ported from ums-knowledge-reference/backend/src/utils/resilience.ts.
 */

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly label: string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 30_000,
  ) {}

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
      this.transitionTo("half-open");
    }
    return this.state;
  }

  /**
   * Execute `fn` under the circuit breaker.
   *
   * F-17: callers can supply `isFailure(err)` to classify errors. Returning
   * false means "this error doesn't indicate an unhealthy upstream — surface
   * it but don't count it toward the failure threshold." This prevents
   * client-side errors (e.g. Bedrock 4xx schema rejections, malformed
   * prompts) from tripping the breaker and brownout-ing healthy traffic.
   * Default behavior (no `isFailure`) treats every error as a failure to
   * preserve existing semantics for other callers.
   */
  async execute<T>(fn: () => Promise<T>, isFailure?: (err: unknown) => boolean): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new Error(`Circuit breaker [${this.label}] is open — call rejected (${this.failureCount} consecutive failures, cooling down)`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const counts = isFailure ? isFailure(error) : true;
      if (counts) this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      logger.info("Circuit breaker test call succeeded, closing circuit", { label: this.label });
    }
    this.failureCount = 0;
    this.transitionTo("closed");
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      this.transitionTo("open");
    } else if (this.failureCount >= this.failureThreshold) {
      this.transitionTo("open");
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      logger.warn("Circuit breaker state transition", { label: this.label, from: this.state, to: newState, failures: this.failureCount });
      this.state = newState;
    }
  }
}

