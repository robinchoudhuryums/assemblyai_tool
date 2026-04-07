/**
 * OpenTelemetry Tracing Configuration
 *
 * Initializes distributed tracing for CallAnalyzer.
 * Must be imported BEFORE any other application code (Express, AWS SDK, etc.)
 * so the auto-instrumentation hooks are registered before modules load.
 *
 * Configuration via environment variables:
 *   OTEL_ENABLED=true              — Enable tracing (disabled by default)
 *   OTEL_EXPORTER_OTLP_ENDPOINT   — OTLP collector endpoint (default: http://localhost:4318)
 *   OTEL_SERVICE_NAME              — Service name (default: callanalyzer)
 *   OTEL_ENVIRONMENT               — Deployment environment tag (default: development)
 *
 * Compatible with: Jaeger, Grafana Tempo, Datadog, AWS X-Ray (via OTLP), Honeycomb
 *
 * Ported from ums-knowledge-reference/backend/src/tracing.ts.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { resourceFromAttributes } from "@opentelemetry/resources";

const OTEL_ENABLED = process.env.OTEL_ENABLED === "true";

if (OTEL_ENABLED) {
  const serviceName = process.env.OTEL_SERVICE_NAME || "callanalyzer";
  const environment = process.env.OTEL_ENVIRONMENT || process.env.NODE_ENV || "development";

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      "deployment.environment": environment,
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
        : undefined,
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === "/api/health",
      }),
      new ExpressInstrumentation(),
    ],
  });

  sdk.start();

  const shutdown = async () => {
    try { await sdk.shutdown(); } catch { /* ignore */ }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(`[OTEL] Tracing enabled — service=${serviceName} env=${environment}`);
} else {
  console.log("[OTEL] Tracing disabled (set OTEL_ENABLED=true to enable)");
}
