/**
 * Structured JSON logger for production observability.
 *
 * Outputs newline-delimited JSON to stdout/stderr, compatible with CloudWatch,
 * Datadog, Splunk, ELK, and any log aggregator that parses JSON lines.
 *
 * Automatically includes correlation ID (per-request) and call ID (per-pipeline)
 * from AsyncLocalStorage context, enabling trace-level filtering across all log lines.
 *
 * HIPAA: Never logs PHI (transcript content, audio data, patient names).
 * Only logs metadata: IDs, timestamps, durations, counts, status codes.
 */

import { getCorrelationId, getCallId } from "./correlation-id";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CONFIGURED_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || "info"] ?? LOG_LEVELS.info;

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  correlationId?: string;
  callId?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < CONFIGURED_LEVEL) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: "callanalyzer",
  };

  // Inject correlation/call IDs from AsyncLocalStorage context
  const correlationId = getCorrelationId();
  if (correlationId) entry.correlationId = correlationId;
  const callId = getCallId();
  if (callId) entry.callId = callId;

  if (meta) Object.assign(entry, meta);

  const line = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};

/**
 * In-memory metrics collector.
 *
 * Tracks counters (monotonically increasing) and histograms (timing distributions).
 * Exposed via GET /api/admin/metrics for Prometheus scraping or manual inspection.
 */
class MetricsCollector {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private startTime = Date.now();

  increment(name: string, value = 1, labels?: Record<string, string>): void {
    const key = labels ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}` : name;
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  observe(name: string, value: number, labels?: Record<string, string>): void {
    const key = labels ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",")}}` : name;
    const values = this.histograms.get(key) || [];
    values.push(value);
    // Keep last 1000 observations to prevent unbounded memory growth
    if (values.length > 1000) values.shift();
    this.histograms.set(key, values);
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      uptime_seconds: Math.round((Date.now() - this.startTime) / 1000),
      counters: Object.fromEntries(this.counters),
      histograms: {} as Record<string, { count: number; mean: number; p50: number; p95: number; p99: number }>,
    };

    const histogramStats = result.histograms as Record<string, unknown>;
    for (const [name, values] of this.histograms) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      histogramStats[name] = {
        count: sorted.length,
        mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      };
    }

    // Process memory (useful for detecting leaks)
    const mem = process.memoryUsage();
    (result as Record<string, unknown>).memory = {
      rss_mb: Math.round(mem.rss / 1048576),
      heap_used_mb: Math.round(mem.heapUsed / 1048576),
      heap_total_mb: Math.round(mem.heapTotal / 1048576),
      external_mb: Math.round(mem.external / 1048576),
    };

    return result;
  }
}

export const metrics = new MetricsCollector();
