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

// ---------------------------------------------------------------------------
// PerKeyCircuitBreaker
// ---------------------------------------------------------------------------
//
// Keyed variant of CircuitBreaker — holds an independent state machine per
// key so one failing target (e.g. one webhook URL) doesn't brownout the rest.
// Used by `webhooks.ts` to open a circuit per `webhookId` when a receiver is
// consistently failing, so the app stops queueing new deliveries (and new
// retries) for that specific receiver until the cooldown passes.
//
// Bounded to MAX_KEYS entries with LRU eviction to prevent unbounded growth
// under pathological key churn (e.g. if keys aren't actually stable). 1,000
// is far beyond any realistic number of webhook configs.

export type CircuitSnapshot = {
  key: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
};

export class PerKeyCircuitBreaker {
  private breakers = new Map<string, CircuitBreaker>();
  private readonly MAX_KEYS = 1_000;

  constructor(
    private readonly labelPrefix: string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 30_000,
  ) {}

  private getOrCreate(key: string, override?: { threshold?: number; resetMs?: number }): CircuitBreaker {
    let b = this.breakers.get(key);
    if (b) {
      // LRU touch: delete-then-set to move to the most-recently-used end.
      this.breakers.delete(key);
      this.breakers.set(key, b);
      return b;
    }
    if (this.breakers.size >= this.MAX_KEYS) {
      const oldest = this.breakers.keys().next().value;
      if (oldest !== undefined) this.breakers.delete(oldest);
    }
    // Per-key override is applied only on first creation. A later policy
    // change by the caller won't retroactively update the breaker — the
    // caller must `reset(key)` to recreate with new thresholds.
    const threshold = override?.threshold ?? this.failureThreshold;
    const resetMs = override?.resetMs ?? this.resetTimeoutMs;
    b = new CircuitBreaker(`${this.labelPrefix}:${key}`, threshold, resetMs);
    this.breakers.set(key, b);
    return b;
  }

  /**
   * Execute `fn` under the per-key circuit. Throws immediately if the key's
   * circuit is open. Optional `override.threshold` / `override.resetMs` are
   * applied only when first creating a breaker for this key; subsequent
   * policy changes require an explicit `reset(key)` to take effect.
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    isFailureOrOptions?: ((err: unknown) => boolean) | { isFailure?: (err: unknown) => boolean; threshold?: number; resetMs?: number },
  ): Promise<T> {
    // Back-compat: allow the third arg to be a plain isFailure predicate OR
    // an options object carrying threshold/resetMs overrides.
    const opts = typeof isFailureOrOptions === "function"
      ? { isFailure: isFailureOrOptions }
      : (isFailureOrOptions ?? {});
    const override = opts.threshold !== undefined || opts.resetMs !== undefined
      ? { threshold: opts.threshold, resetMs: opts.resetMs }
      : undefined;
    return this.getOrCreate(key, override).execute(fn, opts.isFailure);
  }

  /** Current state for a specific key — "closed" for unknown keys. */
  getState(key: string): CircuitState {
    const b = this.breakers.get(key);
    return b ? b.getState() : "closed";
  }

  /** True when the key's breaker is currently open. Cheap read; no state transition. */
  isOpen(key: string): boolean {
    return this.getState(key) === "open";
  }

  /** Snapshot of all currently-tracked breakers, sorted by most-recently-failed. */
  snapshot(): CircuitSnapshot[] {
    const out: CircuitSnapshot[] = [];
    for (const [key, b] of this.breakers) {
      out.push({
        key,
        state: b.getState(),
        // CircuitBreaker doesn't expose these directly; use accessor methods.
        failureCount: (b as unknown as { failureCount: number }).failureCount,
        lastFailureTime: (b as unknown as { lastFailureTime: number }).lastFailureTime,
      });
    }
    return out.sort((a, b) => b.lastFailureTime - a.lastFailureTime);
  }

  /** Test seam — reset a specific key's breaker. */
  reset(key: string): void {
    this.breakers.delete(key);
  }

  /** Test seam — reset all breakers. */
  resetAll(): void {
    this.breakers.clear();
  }
}

