import fs from "fs";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "../services/logger";

// ── Path Parameter Validation ────────────────────────────────────────
// Reusable middleware to reject malformed route params early, before they
// reach database queries. Prevents timing attacks, confusing DB errors,
// and potential injection via params that bypass body validation.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[\w-]{1,255}$/; // alphanumeric, underscores, hyphens
const SAFE_NAME_RE = /^[\w\s.'\-,&()]{1,255}$/; // team/employee names (allows spaces, punctuation)

/** Validate that specific req.params match expected formats. */
export function validateParams(
  specs: Record<string, "uuid" | "safeId" | "safeName">
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const [param, format] of Object.entries(specs)) {
      const value = req.params[param];
      if (value === undefined) continue; // optional param not present

      let valid = false;
      switch (format) {
        case "uuid":
          valid = UUID_RE.test(value);
          break;
        case "safeId":
          valid = SAFE_ID_RE.test(value);
          break;
        case "safeName":
          try {
            valid = SAFE_NAME_RE.test(decodeURIComponent(value));
          } catch {
            // Malformed percent-encoding (URIError) → reject as invalid
            valid = false;
          }
          break;
      }

      if (!valid) {
        res.status(400).json({ message: `Invalid ${param} parameter` });
        return;
      }
    }
    next();
  };
}

/** Shorthand: validate that :id is a valid UUID. */
export const validateIdParam = validateParams({ id: "uuid" });

// ── Standardized Error Responses ─────────────────────────────────────
// All API error responses follow a consistent shape:
//   { message: string, errors?: unknown }
// This makes client-side error handling predictable.

import { type ZodError } from "zod";

/** Send a JSON error response with a consistent shape. */
export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ message });
}

/** Send a 400 with Zod validation errors (always uses .flatten() for consistency). */
export function sendValidationError(res: Response, message: string, zodError: ZodError): void {
  // Include BOTH .flatten() (backward compat — existing clients parse
  // `errors.fieldErrors`) and an `issues` array that preserves the full
  // dot-path to each failing field. `.flatten()` collapses
  // `["script","voices","agent"]` to `fieldErrors.script`, which makes
  // nested-field debugging impossible from the response body alone.
  // `issues` keeps the original Zod path so operators can pinpoint the
  // exact failing subfield ("script.voices.agent" vs "script.title" etc.).
  res.status(400).json({
    message,
    errors: zodError.flatten(),
    issues: zodError.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    })),
  });
}

/** Parse an integer query param with bounds, returning defaultVal on NaN/missing. */
export function clampInt(value: string | undefined, defaultVal: number, min: number, max: number): number {
  if (!value) return defaultVal;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? defaultVal : Math.max(min, Math.min(n, max));
}

/** Parse a date query param, returning undefined if invalid. */
export function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Safe parseFloat that returns fallback on NaN. Accepts string or number input. */
export function safeFloat(value: string | number | undefined | null, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isNaN(n) ? fallback : n;
}

/** Safe JSON.parse that returns fallback on failure. */
export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

/** Delete uploaded file after processing (A25/F58). */
export async function cleanupFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    // ENOENT = already gone, not an error worth logging
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    logger.error("failed to cleanup file", { error: (error as Error).message });
  }
}

// --- Shared Route Helpers ---
// Extracted from duplicate implementations across routes to ensure consistency.

/**
 * Escape a value for CSV output, preventing formula injection.
 * Prefixes formula-triggering characters (=, +, -, @, tab, CR) with a single quote,
 * then wraps in double quotes if the value contains commas, quotes, or newlines.
 */
export function escapeCsvValue(val: unknown): string {
  let s = String(val ?? "");
  if (/^[=+\-@\t\r]/.test(s)) { s = "'" + s; }
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One section of a multi-section CSV — a labelled table with headers + rows. */
export interface CsvSection {
  /** Optional blank-line separator from the previous section. Default true. */
  separator?: boolean;
  /** Column headers. */
  headers: string[];
  /** Rows. Each cell is CSV-escaped via escapeCsvValue. */
  rows: unknown[][];
  /**
   * PDF-only: optional chart rendered ABOVE the table (or standalone when
   * headers/rows are empty). Ignored by `buildCsv`. `line` renders each
   * series as a polyline; `bar` renders horizontal bars labelled on the
   * left. Values may be null — nulls are skipped, not drawn at zero.
   */
  chart?: PdfChartSpec;
}

/** PDF chart spec — supports two shapes rendered via pdfkit paths. */
export type PdfChartSpec =
  | {
      type: "line";
      title?: string;
      /** Each series = one polyline. Multiple series share the same axes. */
      series: Array<{ label: string; points: Array<{ x: string | number; y: number | null }> }>;
      height?: number;
      valueRange?: { min?: number; max?: number };
    }
  | {
      type: "bar";
      title?: string;
      /** Single-series horizontal bars, top-down. */
      bars: Array<{ label: string; value: number | null }>;
      height?: number;
      valueRange?: { min?: number; max?: number };
    };

/**
 * Build a multi-section CSV body from a list of `CsvSection`s. Sections are
 * separated by a blank line. Every cell is escaped via `escapeCsvValue` so
 * callers can pass raw values. Used by all server-side report export routes
 * (agent profile, filtered report, team analytics, etc.) so the output
 * format and formula-injection protection stay consistent.
 */
export function buildCsv(sections: CsvSection[]): string {
  const lines: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (i > 0 && section.separator !== false) lines.push("");
    lines.push(section.headers.map(h => escapeCsvValue(h)).join(","));
    for (const row of section.rows) {
      lines.push(row.map(cell => escapeCsvValue(cell)).join(","));
    }
  }
  return lines.join("\n");
}

/**
 * Write a CSV response with the HIPAA export audit entry, consistent
 * filename quoting, and the correct content-type header. The `audit`
 * callback is invoked after all headers are set but before the body is
 * sent; callers use it to run `logPhiAccess` with the export-specific
 * detail string.
 */
export function writeCsvResponse(
  res: import("express").Response,
  csv: string,
  filename: string,
  audit?: () => void,
): void {
  if (audit) {
    try { audit(); } catch (err) {
      // Audit failure must not prevent the caller from receiving the
      // export — but log it so the gap is observable.
      // eslint-disable-next-line no-console
      console.warn("[csv-export] audit logger threw", err);
    }
  }
  // Sanitize filename to prevent header injection via newline or quote.
  const safe = filename.replace(/[\r\n"\\]/g, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.send(csv);
}

/**
 * PDF report metadata — rendered as the document header before the first
 * section. `title` is the display-font page title; `kicker` is the small
 * mono-uppercase label above it (typically report type + period).
 */
export interface PdfReportMetadata {
  title: string;
  kicker?: string;
  companyName?: string;
  period?: string;
  generatedAt?: Date;
}

/**
 * Render an inline chart inside a PDF document. Uses pdfkit's path
 * primitives (moveTo / lineTo / rect / stroke / fill) so no new
 * dependency is needed. Coordinates are in PDF points; the caller passes
 * `pageWidth` (the usable width between the margins) and this function
 * draws the chart starting at the current `doc.y` and advances `doc.y`
 * past the bottom of the chart when done.
 *
 * Line chart:  timeseries with a dashed zero baseline, one polyline per
 *              series. Y-axis auto-ranges (min/max from data, padded).
 * Bar chart:   horizontal bars with labels on the left, values on the
 *              right. Bar width scales by the max absolute value.
 *
 * Null/NaN points are skipped for line charts and rendered as blanks
 * (no bar) for bar charts — same convention the on-screen analytics use.
 */
// Typed against pdfkit's doc without importing the types at module scope
// (pdfkit is lazy-loaded in buildPdfBuffer to avoid the font load cost on
// tests that never touch PDFs).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderChart(doc: any, chart: PdfChartSpec, pageWidth: number): void {
  const startY = doc.y;
  const leftX = doc.page.margins.left;
  const rightX = leftX + pageWidth;

  // Optional title above the chart, left-aligned.
  if (chart.title) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#2a2420");
    doc.text(chart.title, leftX, startY);
    doc.moveDown(0.2);
  }
  const plotTop = doc.y + 4;
  const plotHeight = chart.height ?? 90;

  if (chart.type === "line") {
    // Flatten all points across series to compute the shared Y range.
    const allY: number[] = [];
    for (const s of chart.series) {
      for (const p of s.points) if (p.y !== null && Number.isFinite(p.y)) allY.push(p.y);
    }
    if (allY.length === 0) {
      // Render an empty plot with just the zero baseline so the caller
      // still gets a visual placeholder instead of a silent blank.
      doc.strokeColor("#d9cfc4").lineWidth(0.5).dash(2, { space: 2 })
        .moveTo(leftX, plotTop + plotHeight / 2)
        .lineTo(rightX, plotTop + plotHeight / 2)
        .stroke()
        .undash();
      doc.y = plotTop + plotHeight + 4;
      return;
    }
    const dataMin = chart.valueRange?.min ?? Math.min(0, ...allY);
    const dataMax = chart.valueRange?.max ?? Math.max(0, ...allY);
    const span = (dataMax - dataMin) || 1;

    // Assume all series share the same X points (our callers do). Use the
    // longest series as the X axis count.
    const maxPoints = Math.max(...chart.series.map(s => s.points.length), 1);
    const plotWidth = pageWidth;
    const xForIdx = (idx: number) =>
      leftX + (idx / Math.max(maxPoints - 1, 1)) * plotWidth;
    const yForVal = (v: number) =>
      plotTop + plotHeight - ((v - dataMin) / span) * plotHeight;

    // Dashed zero baseline, but only if zero is within the visible range.
    if (dataMin <= 0 && dataMax >= 0) {
      const zeroY = yForVal(0);
      doc.strokeColor("#d9cfc4").lineWidth(0.5).dash(2, { space: 2 })
        .moveTo(leftX, zeroY).lineTo(rightX, zeroY).stroke().undash();
    }

    // Per-series rendering. First series = accent color; subsequent series
    // share a muted palette. Keeping it simple — callers typically use
    // one series.
    const palette = ["#b8733f", "#7a6b5a", "#8fa68a", "#a85533"];
    for (let si = 0; si < chart.series.length; si++) {
      const s = chart.series[si];
      const color = palette[si % palette.length];
      doc.strokeColor(color).lineWidth(1.5);
      let started = false;
      for (let pi = 0; pi < s.points.length; pi++) {
        const p = s.points[pi];
        if (p.y === null || !Number.isFinite(p.y)) continue;
        const x = xForIdx(pi);
        const y = yForVal(p.y);
        if (!started) {
          doc.moveTo(x, y);
          started = true;
        } else {
          doc.lineTo(x, y);
        }
      }
      if (started) doc.stroke();
      // Point dots for visibility at chart scale.
      doc.fillColor(color);
      for (let pi = 0; pi < s.points.length; pi++) {
        const p = s.points[pi];
        if (p.y === null || !Number.isFinite(p.y)) continue;
        doc.circle(xForIdx(pi), yForVal(p.y), 1.5).fill();
      }
    }
    doc.y = plotTop + plotHeight + 6;
    return;
  }

  // Bar chart
  const bars = chart.bars;
  const labelColW = 140;
  const valueColW = 50;
  const barsLeft = leftX + labelColW;
  const barsWidth = pageWidth - labelColW - valueColW;
  const rowHeight = 16;
  const barRowTop = plotTop;
  const allValues = bars.map(b => b.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const maxAbs = allValues.length > 0 ? Math.max(...allValues.map(v => Math.abs(v)), 0) : 1;
  const scale = maxAbs > 0 ? barsWidth / maxAbs : 0;

  for (let bi = 0; bi < bars.length; bi++) {
    const y = barRowTop + bi * rowHeight;
    // Page-break guard — push to next page if we'd overflow.
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      // Reset plotTop-equivalent to the top of the new page.
      return renderChart(doc, { ...chart, bars: bars.slice(bi) }, pageWidth);
    }
    const b = bars[bi];
    // Label on left.
    doc.font("Helvetica").fontSize(9).fillColor("#2a2420");
    doc.text(String(b.label), leftX, y + 3, { width: labelColW - 6, ellipsis: true });
    if (b.value !== null && Number.isFinite(b.value) && scale > 0) {
      const w = Math.max(1, Math.abs(b.value) * scale);
      doc.rect(barsLeft, y + 3, w, rowHeight - 8)
        .fill(b.value >= 0 ? "#b8733f" : "#a85533");
      // Value label on right.
      doc.fillColor("#2a2420").font("Helvetica").fontSize(9);
      doc.text(b.value.toFixed(2), barsLeft + barsWidth + 4, y + 3, {
        width: valueColW - 4,
      });
    } else {
      doc.fillColor("#7a6b5a").font("Helvetica").fontSize(9);
      doc.text("—", barsLeft + barsWidth + 4, y + 3, { width: valueColW - 4 });
    }
  }
  doc.y = barRowTop + bars.length * rowHeight + 6;
}

/**
 * Build a PDF buffer from the same CsvSection shape `buildCsv` accepts.
 * Produces a tabular PDF: a title page header, then each section as a
 * labelled table. Uses pdfkit's synchronous row rendering + wraps long
 * cells. Returned as a Promise<Buffer> rather than a stream because
 * aggregating the entire buffer keeps error semantics predictable:
 * if PDF generation throws after headers are sent, the client would
 * see a truncated file. Buffering up front lets us catch failures and
 * 500 cleanly.
 *
 * Typical exports (filtered reports, agent profiles) are <100 KB, so
 * buffering is cheap. If a very large export arrives, switch to
 * `pdf.pipe(res)` at the route level.
 */
export async function buildPdfBuffer(
  sections: CsvSection[],
  metadata: PdfReportMetadata,
): Promise<Buffer> {
  // Lazy-load pdfkit so Node test runs that never touch PDF exports
  // don't pay the startup cost. The package initializes font lookups
  // on require, which would add ~80ms to every test run.
  const PDFDocumentMod = await import("pdfkit");
  const PDFDocument = (PDFDocumentMod as unknown as { default: typeof import("pdfkit") }).default;

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "LETTER",
        margin: 54,  // 0.75"
        info: {
          Title: metadata.title,
          Author: metadata.companyName ?? "CallAnalyzer",
          Subject: metadata.kicker ?? "Call analytics report",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // --- Header ---
      if (metadata.kicker) {
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor("#7a6b5a")
          .text(metadata.kicker.toUpperCase(), { characterSpacing: 1.4 });
        doc.moveDown(0.3);
      }
      doc
        .font("Helvetica-Bold")
        .fontSize(22)
        .fillColor("#2a2420")
        .text(metadata.title);
      const metaLine = [
        metadata.companyName,
        metadata.period,
        metadata.generatedAt
          ? `Generated ${metadata.generatedAt.toISOString().slice(0, 10)}`
          : null,
      ].filter(Boolean).join("  ·  ");
      if (metaLine) {
        doc.moveDown(0.3);
        doc.font("Helvetica").fontSize(10).fillColor("#7a6b5a").text(metaLine);
      }
      doc.moveDown(1.2);

      // --- Sections ---
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (i > 0) doc.moveDown(0.8);

        // Optional chart rendered above the table (or standalone when the
        // section has no headers/rows). Kept inline rather than extracted
        // so it reads top-to-bottom with the table rendering below.
        if (section.chart) {
          renderChart(doc, section.chart, pageWidth);
          doc.moveDown(0.4);
        }

        // If headers are empty, this was a chart-only section — skip the
        // table rendering entirely.
        if (section.headers.length === 0) continue;

        // Approximate column widths: divide the page width evenly. pdfkit
        // doesn't have a real table primitive so we lay out row-by-row.
        const cols = section.headers.length;
        const colW = pageWidth / cols;

        // Header row
        const rowY = doc.y;
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#2a2420");
        for (let c = 0; c < cols; c++) {
          doc.text(String(section.headers[c]), doc.page.margins.left + c * colW, rowY, {
            width: colW - 6,
            ellipsis: true,
          });
        }
        // Compute the tallest cell height so the underline sits below everything.
        const headerHeight = Math.max(14, doc.y - rowY);
        doc
          .strokeColor("#d9cfc4")
          .lineWidth(0.75)
          .moveTo(doc.page.margins.left, rowY + headerHeight + 2)
          .lineTo(doc.page.margins.left + pageWidth, rowY + headerHeight + 2)
          .stroke();
        doc.y = rowY + headerHeight + 8;

        // Data rows
        doc.font("Helvetica").fontSize(9).fillColor("#2a2420");
        for (const row of section.rows) {
          // Add a new page if we'd overflow.
          if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
            doc.addPage();
          }
          const rY = doc.y;
          let tallest = 0;
          for (let c = 0; c < cols; c++) {
            const cellText = row[c] === undefined || row[c] === null ? "" : String(row[c]);
            doc.text(cellText, doc.page.margins.left + c * colW, rY, {
              width: colW - 6,
              ellipsis: true,
            });
            tallest = Math.max(tallest, doc.y - rY);
          }
          doc.y = rY + Math.max(tallest, 12) + 4;
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Write a PDF response with the HIPAA export audit entry, consistent
 * filename quoting, and the correct content-type header. Mirrors
 * `writeCsvResponse` — audit fires first, then the buffer is sent.
 * Callers pass an already-built Buffer (from `buildPdfBuffer`) so
 * synchronous generation errors surface before response headers are
 * written.
 */
export function writePdfResponse(
  res: import("express").Response,
  pdf: Buffer,
  filename: string,
  audit?: () => void,
): void {
  if (audit) {
    try { audit(); } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[pdf-export] audit logger threw", err);
    }
  }
  const safe = filename.replace(/[\r\n"\\]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("Content-Length", String(pdf.byteLength));
  res.send(pdf);
}

// ---------------------------------------------------------------------------
// Fuzzy string matching (Levenshtein distance + simple normalization)
// ---------------------------------------------------------------------------
//
// Used by the unlinked-users admin flow (Phase E) to suggest employee
// candidates when a user's username/displayName doesn't match any employee
// exactly. Cheap enough to run at request time over the full employee list
// (~50–500 rows typical) because the algorithm is O(n*m) per pair and names
// are short; a 500-employee × 10-unlinked computation finishes in well under
// 100ms on modern hardware.

/** Levenshtein distance between two strings (0 = identical). */
export function levenshtein(a: string, b: string): number {
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  // Use two rolling rows instead of a full matrix — bounded memory.
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,          // deletion
        prev[j - 1] + cost,   // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/**
 * Normalize a string for fuzzy comparison: lowercase, collapse whitespace,
 * strip common email separators ("alice.smith@x.com" → "alice smith"),
 * strip punctuation. Intentionally liberal — we want "alice.smith@x.com"
 * to fuzzy-match "Alice Smith" and "Bob J" to match "Bob Jones".
 */
export function normalizeForFuzzy(s: string): string {
  return s
    .toLowerCase()
    .replace(/@.*$/, "")                // drop email domain
    .replace(/[._\-+]/g, " ")           // separators → space
    .replace(/[^a-z0-9\s]/g, "")        // strip remaining punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score (0–1) of how similar `a` and `b` are. 1 = identical after
 * normalization. Returns 0 when normalized forms share no prefix and are
 * very different lengths. Uses Levenshtein distance over the normalized
 * forms; score = 1 - distance / max(len).
 */
export function fuzzySimilarity(a: string, b: string): number {
  const na = normalizeForFuzzy(a);
  const nb = normalizeForFuzzy(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Filter calls by date range (in-memory). Adjusts `to` date to end-of-day.
 * Used by reports, snapshots, and search — the single source of truth for date filtering.
 */
export function filterCallsByDateRange<T extends { uploadedAt?: string | null }>(
  calls: T[],
  from?: string | Date,
  to?: string | Date,
): T[] {
  let result = calls;
  const fromDate = from ? (from instanceof Date ? from : parseDate(from as string)) : undefined;
  const toDate = to ? (to instanceof Date ? to : parseDate(to as string)) : undefined;

  if (fromDate) {
    result = result.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
  }
  if (toDate) {
    // F-17: use setUTCHours so end-of-day is UTC-consistent with uploadedAt (stored as UTC).
    // Previously used setHours (local timezone), causing ±12h date boundary errors.
    const endOfDay = new Date(toDate);
    endOfDay.setUTCHours(23, 59, 59, 999);
    result = result.filter(c => new Date(c.uploadedAt || 0) <= endOfDay);
  }
  return result;
}

/** Count frequency of items in a string array. Returns top N entries sorted by count. */
export function countFrequency(arr: string[], limit = 10): Array<{ text: string; count: number }> {
  const freq = new Map<string, number>();
  for (const item of arr) {
    const normalized = item.trim().toLowerCase();
    if (normalized) freq.set(normalized, (freq.get(normalized) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

/** Calculate sentiment breakdown from an array of calls with sentiment data. */
export function calculateSentimentBreakdown(calls: Array<{ sentiment?: { overallSentiment?: string } | null }>): { positive: number; neutral: number; negative: number } {
  const result = { positive: 0, neutral: 0, negative: 0 };
  for (const c of calls) {
    const s = c.sentiment?.overallSentiment as keyof typeof result | undefined;
    if (s && s in result) result[s]++;
  }
  return result;
}

/** Calculate average score from an array of values, with configurable decimal places. Returns null if no valid scores. */
export function calculateAvgScore(scores: number[], decimals = 2): number | null {
  const valid = scores.filter(s => Number.isFinite(s) && s > 0);
  if (valid.length === 0) return null;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const factor = Math.pow(10, decimals);
  return Math.round(avg * factor) / factor;
}

// --- Confidence Score Calculation ---
// Shared formula used by both real-time pipeline and batch inference.
// Weights: transcript accuracy (40%) + word density (20%) + call duration (15%) + AI completeness (25%)

export interface ConfidenceInput {
  transcriptConfidence: number;  // 0-1, from AssemblyAI
  wordCount: number;             // number of words in transcript
  callDurationSeconds: number;   // call length in seconds
  hasAiAnalysis: boolean;        // whether AI (Bedrock) analysis was completed
}

export interface ConfidenceResult {
  score: number;
  factors: {
    transcriptConfidence: number;
    wordCount: number;
    callDurationSeconds: number;
    aiAnalysisCompleted: boolean;
    overallScore: number;
  };
}

// A28/F81: dead transcriptLength param removed. A28/F85: wordConfidence
// saturation raised from 50 to 150 words (50 was saturating on sub-minute calls
// and giving artificially high scores).
const WORD_CONFIDENCE_SATURATION = 150;

export function computeConfidenceScore(input: ConfidenceInput): ConfidenceResult {
  const { wordCount, callDurationSeconds, hasAiAnalysis } = input;
  const safeTranscriptConf = Number.isFinite(input.transcriptConfidence) ? input.transcriptConfidence : 0;
  const safeWordCount = Number.isFinite(wordCount) ? wordCount : 0;
  const safeDuration = Number.isFinite(callDurationSeconds) ? callDurationSeconds : 0;

  const wordConfidence = Math.min(safeWordCount / WORD_CONFIDENCE_SATURATION, 1);
  const durationConfidence = safeDuration > 30 ? 1 : safeDuration / 30;
  const aiConfidence = hasAiAnalysis ? 1 : 0.3;

  const score = (
    safeTranscriptConf * 0.4 +
    wordConfidence * 0.2 +
    durationConfidence * 0.15 +
    aiConfidence * 0.25
  );

  return {
    score,
    factors: {
      transcriptConfidence: Math.round(safeTranscriptConf * 100) / 100,
      wordCount: safeWordCount,
      callDurationSeconds: safeDuration,
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(score * 100) / 100,
    },
  };
}

// --- Auto-Assign Employee ---
// Shared logic: detect agent name → find matching employee → atomic assign.

export async function autoAssignEmployee(
  callId: string,
  detectedAgentName: string,
  storage: { findEmployeeByName(name: string): Promise<{ id: string; name: string } | undefined>; atomicAssignEmployee(callId: string, employeeId: string): Promise<boolean> },
  logPrefix = "",
): Promise<{ assigned: boolean; employeeName?: string }> {
  const detectedName = detectedAgentName.trim();
  const matchedEmployee = await storage.findEmployeeByName(detectedName);

  if (!matchedEmployee) {
    logger.info("detected agent name but no matching employee found", { detectedName });
    return { assigned: false };
  }

  const assigned = await storage.atomicAssignEmployee(callId, matchedEmployee.id);
  if (assigned) {
    logger.info("auto-assigned to employee", { employeeName: matchedEmployee.name, employeeId: matchedEmployee.id });
    return { assigned: true, employeeName: matchedEmployee.name };
  }

  logger.info("call already assigned, skipping auto-assign", { callId });
  return { assigned: false };
}

/**
 * Pricing table (USD per 1K tokens, [input, output]).
 * LAST VERIFIED: 2025-11 against AWS Bedrock on-demand pricing page.
 * Update this comment when values change.
 */
const BEDROCK_PRICING: Record<string, [number, number]> = {
  "us.anthropic.claude-sonnet-4-6": [0.003, 0.015],
  "us.anthropic.claude-sonnet-4-20250514": [0.003, 0.015],
  "us.anthropic.claude-haiku-4-5-20251001": [0.0008, 0.004],
  "anthropic.claude-3-haiku-20240307": [0.00025, 0.00125],
  "anthropic.claude-3-5-sonnet-20241022": [0.003, 0.015],
};

/** Estimate Bedrock cost. Returns null for unknown models (A27/F60 —
 *  previous behavior of silently defaulting to Sonnet pricing hid model
 *  misconfiguration). Note: BEDROCK_BATCH_MODE=true applies 50% discount. */
export function estimateBedrockCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const rates = BEDROCK_PRICING[model];
  if (!rates) return null;
  return (inputTokens / 1000) * rates[0] + (outputTokens / 1000) * rates[1];
}

/** True if `model` is present in BEDROCK_PRICING and will return a non-null cost estimate. */
export function isKnownBedrockModel(model: string | undefined): boolean {
  if (!model) return false;
  return model in BEDROCK_PRICING;
}

/** Returns the list of known Bedrock model IDs for diagnostics / validation messages. */
export function getKnownBedrockModels(): string[] {
  return Object.keys(BEDROCK_PRICING);
}

// Track unknown-model warnings so we only log once per unique model id per process.
// Without this guard, every call would spam Sentry + stdout — but operators who
// typo BEDROCK_MODEL should still see the warning loudly once.
const warnedUnknownModels = new Set<string>();

/**
 * Warn (once per unique model) when a model is missing from BEDROCK_PRICING.
 * Called from the pipeline's usage-tracking path so typos or new models don't
 * silently record $0 cost while AWS still bills. Does NOT throw — cost
 * tracking must not block the pipeline.
 */
export function warnOnUnknownBedrockModel(model: string | undefined, context: Record<string, unknown> = {}): void {
  if (!model || warnedUnknownModels.has(model)) return;
  if (isKnownBedrockModel(model)) return;
  warnedUnknownModels.add(model);
  // Direct logger import avoids a circular require against routes/utils.ts
  // consumers. Kept minimal — this is an operational red flag, not a hot path.
  import("../services/logger").then(({ logger }) => {
    logger.warn("bedrock-cost: unknown model, cost tracked as $0", {
      alert: "bedrock_unknown_model",
      model,
      known: Object.keys(BEDROCK_PRICING),
      ...context,
    });
  }).catch(() => { /* noop — logger should always import */ });
}

// AssemblyAI pricing LAST VERIFIED: 2025-11. Base $0.15/hr + sentiment $0.02/hr.
const ASSEMBLYAI_RATE_PER_SEC_WITH_SENTIMENT = 0.17 / 3600;
const ASSEMBLYAI_RATE_PER_SEC_BASE = 0.15 / 3600;
/** Estimate AssemblyAI cost from duration. */
export function estimateAssemblyAICost(durationSeconds: number, sentimentEnabled = true): number {
  const rate = sentimentEnabled ? ASSEMBLYAI_RATE_PER_SEC_WITH_SENTIMENT : ASSEMBLYAI_RATE_PER_SEC_BASE;
  return durationSeconds * rate;
}

// Titan Embed V2 pricing LAST VERIFIED: 2025-11. $0.00002 per 1K tokens.
const TITAN_EMBED_V2_RATE_PER_1K = 0.00002;
/** Estimate Bedrock Titan Embed V2 cost from raw text length. */
export function estimateEmbeddingCost(textLength: number): number {
  const estimatedTokens = Math.ceil(textLength / 4);
  return (estimatedTokens / 1000) * TITAN_EMBED_V2_RATE_PER_1K;
}

/**
 * Concurrency-limited task queue for expensive async operations.
 *
 * Bounds (A11/F16/F76):
 * - `concurrency`: max parallel tasks
 * - `maxQueueSize`: max queued (non-running) tasks; new add() rejects with
 *   QueueFullError when exceeded — backpressure for callers (return 503).
 * - `taskTimeoutMs`: per-task wall clock; rejects with TaskTimeoutError on
 *   expiry. Tasks needing >10min should use the durable PostgreSQL job queue.
 */
export class QueueFullError extends Error {
  constructor() { super("Task queue is full"); this.name = "QueueFullError"; }
}
export class TaskTimeoutError extends Error {
  constructor() { super("Task exceeded timeout"); this.name = "TaskTimeoutError"; }
}

export class TaskQueue {
  private running = 0;
  private queue: Array<() => void> = [];
  constructor(
    private concurrency: number,
    private maxQueueSize: number = 1000,
    private taskTimeoutMs: number = 10 * 60 * 1000,
  ) {}
  add<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency && this.queue.length >= this.maxQueueSize) {
      return Promise.reject(new QueueFullError());
    }
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.running++;
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new TaskTimeoutError()), this.taskTimeoutMs);
        });
        Promise.race([fn(), timeoutPromise])
          .then(resolve as (v: unknown) => void, reject)
          .finally(() => {
            if (timer) clearTimeout(timer);
            this.running--;
            if (this.queue.length > 0) this.queue.shift()!();
          });
      };
      if (this.running < this.concurrency) run();
      else this.queue.push(run);
    });
  }
}
