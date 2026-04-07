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

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new Error(`Circuit breaker [${this.label}] is open — call rejected (${this.failureCount} consecutive failures, cooling down)`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      console.log(`[CircuitBreaker] [${this.label}] test call succeeded, closing circuit`);
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
      console.warn(`[CircuitBreaker] [${this.label}] ${this.state} → ${newState} (failures: ${this.failureCount})`);
      this.state = newState;
    }
  }
}

