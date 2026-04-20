# CallAnalyzer — AI-Powered Call Quality Analysis Platform

## Project Overview
HIPAA-compliant call analysis tool for a medical supply company (UMS). Agents upload call recordings, which are transcribed by AssemblyAI and analyzed by AWS Bedrock (Claude) for performance scoring, compliance, sentiment, and coaching insights.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter (routing), TanStack Query. Design system: warm-paper palette + Inter Tight / Inter / IBM Plex Mono, tokens in `client/src/index.css`, Claude Design handoff bundle preserved at `docs/design-bundle/`.
- **Backend**: Express.js + TypeScript (ESM), runs on Node
- **AI**: AWS Bedrock (Claude Sonnet) for call analysis, AssemblyAI for transcription (with webhook support)
- **Error Tracking**: AWS CloudWatch Logs + Alarms (structured JSON via logger; Sentry removed)
- **Database**: AWS RDS PostgreSQL — metadata, sessions, job queue, HIPAA audit log (optional; falls back to S3-only or in-memory)
- **Storage**: AWS S3 (`ums-call-archive` bucket) — audio blobs (when PostgreSQL is configured, metadata lives in RDS)
- **Auth**: Session-based with bcrypt, role-based (viewer/manager/admin), PostgreSQL session store (falls back to memorystore)
- **Hosting**: EC2 with pm2 + Caddy (primary)

## Local Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (see `.env.example`):
   - **Required**: `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`
   - **Auth users**: `AUTH_USERS` — format: `username:password:role:displayName` (comma-separated for multiple)
   - **AWS (for Bedrock + S3)**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
   - **Database** (recommended): `DATABASE_URL` — PostgreSQL connection string for durable metadata, sessions, and job queue
   - **Storage**: `S3_BUCKET` — audio blob storage (without DATABASE_URL or S3_BUCKET, falls back to **in-memory storage**)

3. Start the dev server:
   ```bash
   npm run dev   # Starts on port 5000 (or $PORT) with Vite HMR + tsx watch
   ```

## Commands
```bash
npm run dev          # Dev server (tsx watch)
npm run build        # Vite frontend + esbuild backend → dist/
npm run start        # Production server (NODE_ENV=production node dist/index.js)
npm run check        # TypeScript type check
npm run test         # Run backend tests (tsx --test --test-force-exit tests/*.test.ts — 726 tests)
npm run test:coverage # Backend tests with c8 coverage report (text + text-summary)
npm run test:client  # Run frontend tests (Vitest + React Testing Library — 124 tests)
npm run test:e2e     # Run E2E tests (Playwright — requires dev server)
npm run seed         # Sync employees from CSV + seed simulated-call presets
npm run seed-admin   # Bootstrap a DB admin user (see Operator State Checklist)
npx vite build       # Frontend-only build (useful for quick verification)
```

## Testing
- **Framework**: Node.js built-in `test` module via `tsx` (backend), Vitest + React Testing Library (frontend)
- **Coverage**: Backend ~46% statements / ~78% branches (via `npm run test:coverage`). Frontend lib utilities fully covered. NOTE: prior docs claimed ~67%; the discrepancy hasn't been investigated. CI gate set at 45% (current ~46%) to catch regressions; raising the gate to a meaningful level requires a test-coverage push.
- **Location**: `tests/` directory (backend), `client/src/**/*.test.{ts,tsx}` (frontend)
  - `tests/schema.test.ts` — Zod schema validation for data integrity
  - `tests/ai-provider.test.ts` — AI provider utilities (parseJsonResponse, buildAnalysisPrompt, smartTruncate)
  - `tests/auth.test.ts` — Authentication, session management, and role-based access control
  - `tests/storage.test.ts` — Storage abstraction CRUD operations (all backends)
  - `tests/postgres-storage.test.ts` — PostgresStorage integration tests (requires `DATABASE_URL`)
  - `tests/job-queue.test.ts` — Job queue integration tests (requires `DATABASE_URL`)
  - `tests/pipeline.test.ts` — Audio processing pipeline (transcription, analysis, storage)
  - `tests/confidence-score.test.ts` — Confidence score computation
  - `tests/scoring-calibration.test.ts` — Score calibration and normalization
  - `tests/validation.test.ts` — Input validation and sanitization
  - `tests/utils.test.ts` — Shared utility functions
  - `tests/waf.test.ts` — WAF middleware (SQL injection, XSS, path traversal detection)
  - `tests/sigv4.test.ts` — AWS Signature V4 signing (SHA-256, HMAC, key derivation, canonical requests, presigned URLs)
  - `tests/totp.test.ts` — TOTP/MFA (base32 encoding, RFC 6238 code generation, verification window, OTPAuth URI)
  - `tests/gamification.test.ts` — Gamification logic (points computation, streak detection, badge eligibility)
  - `tests/assemblyai-metrics.test.ts` — AssemblyAI utilities (utterance metrics, speaker-labeled transcripts, interruption/monologue detection)
  - `tests/webhooks.test.ts` — Webhook service (HMAC signatures, config CRUD, event filtering, S3 client fallback)
  - `tests/batch-inference.test.ts` — Batch inference (JSONL input/output format, output parsing, job status, orphan recovery, scheduling thresholds, time-of-day windows)
  - `tests/mfa-enforcement.test.ts` — MFA enforcement (REQUIRE_MFA logic, role-based MFA, challenge flow, TOTP verification, OTPAuth URI, secret generation)
  - `tests/retention.test.ts` — Data retention (cutoff calculation, purgeExpiredCalls, cascade deletion, boundary edge cases)
  - `tests/webhook-delivery.test.ts` — Webhook delivery (HMAC signature generation/verification, event filtering, payload structure, retry logic)
  - `tests/pipeline-errors.test.ts` — Pipeline error handling (AI error classification, parseJsonResponse edge cases, quality gates, null-AI fallback, prompt building)
  - `tests/audit-log.test.ts` — HIPAA audit log (entry format, auditContext extraction, retry config, event taxonomy)
  - `tests/security-monitor.test.ts` — Security monitor (brute-force detection thresholds, credential stuffing, bulk access, severity classification, window expiration)
  - `tests/aws-credentials.test.ts` — AWS credentials (env var resolution, IMDS caching, refresh buffer timing, priority order)
  - `tests/session-integration.test.ts` — Session/login flow (fingerprint consistency, keepSessionInfo, query 401 defaults)
  - `tests/routes.test.ts` — Route endpoint integration tests (HTTP-level auth enforcement, RBAC, input validation, CSV export, MemStorage CRUD)
  - `tests/route-endpoints.test.ts` — Real route handler integration tests (employees CRUD, calls CRUD, user management, dashboard metrics — mounts actual Express routes with MemStorage)
  - `tests/ssrf.test.ts` — SSRF protection (blocked hostnames, private IPs, metadata endpoints, DNS resolution, IPv6-mapped IPv4, protocol enforcement)
  - `tests/synthetic-call-isolation.test.ts` — Synthetic-call isolation regression guard (18 assertions — INV-34/INV-35 enforcement across storage queries, gamification, dashboards, reports, insights)
  - `tests/elevenlabs-client.test.ts` — ElevenLabs TTS client (availability guard, listVoices, textToSpeech buffer return, 429 retry-once behavior, cost estimation defaults and env overrides)
  - `tests/simulated-call-schema.test.ts` — Simulated Call Generator Zod schemas (spoken/hold/interrupt turns, script + config validation, defaults, clamp ranges)
  - `tests/disfluency.test.ts` — Disfluency injection (per-tier filler rates, RNG determinism, empty-input safety, backchannel pool structure)
  - `tests/circumstance-modifiers.test.ts` — Rule-based circumstance modifiers (angry softener stripping, hard_of_hearing repeat prompts, escalation turn appends, composition determinism)
  - `tests/script-rewriter.test.ts` — Bedrock script rewriter (prompt construction, JSON extraction across fenced/prose wrappers, voice-ID preservation contract, error stages: unavailable/model_error/parse_error/validation_error)
- **Frontend test files** (`client/src/`):
  - `lib/display-utils.test.ts` — toDisplayString (type coercion, XSS sanitization), extractErrorMessage
  - `lib/saved-filters.test.ts` — localStorage CRUD for saved search filter presets
  - `lib/dashboard-config.test.ts` — Widget config load/save/merge, moveWidget, toggleWidget
  - `lib/i18n.test.ts` — Translation lookup, locale persistence, fallback behavior
  - `lib/constants.test.ts` — ROLE_CONFIG completeness, pagination defaults
  - `lib/appearance.test.ts` — Theme loading/saving, legacy migration, validation
  - `hooks/use-before-unload.test.ts` — beforeunload listener lifecycle
  - `pages/dashboard.test.tsx` — Dashboard rendering, widget config, empty state, flagged calls
  - `pages/search.test.tsx` — Search input, filters, loading/empty states
  - `pages/auth.test.tsx` — Login form rendering, MFA flow
  - `pages/not-found.test.tsx` — 404 page rendering, accessibility
  - `components/lib/error-boundary.test.tsx` — Error catch, retry, max retries, custom fallback
  - `components/upload/file-upload.test.tsx` — Dropzone, format validation, upload states
  - `components/search/call-card.test.tsx` — Employee display, badges, duration formatting, links
  - `components/ui/button.test.tsx` — Button variants, click handling, disabled state

## Architecture

### Key Directories
```
client/src/pages/        # Route pages (dashboard, transcripts, employees, etc.)
client/src/components/   # UI components (ui/ = shadcn, tables/, transcripts/, dashboard/)
server/db/               # PostgreSQL schema (schema.sql) and connection pool (pool.ts)
server/services/         # AI provider (Bedrock), AI factory, S3 client, AssemblyAI, WebSocket, job queue, TOTP, security monitor, vulnerability scanner, incident response, batch inference/scheduler, transcribing-state orphan reaper, webhooks, coaching alerts, gamification, auto-calibration, telephony-8x8, AWS credentials, URL validator (SSRF), scoring calibration, call clustering, logger, audit log, model tiers, pipeline settings, active model, RAG client, prompt guard, PHI redactor, resilience (circuit breaker), correlation ID, tracing (OpenTelemetry), trace spans, medical synonyms, scoring feedback loop, best practice ingestion, error handler middleware, ElevenLabs client, audio stitcher (ffmpeg), call simulator, simulated-call storage, disfluency injection, circumstance modifiers, script rewriter (Bedrock)
server/constants.ts      # Centralized scoring thresholds (LOW_SCORE, HIGH_SCORE, STREAK, etc.)
server/routes/           # Modular route files (auth, calls, admin, users, analytics, coaching, gamification, etc.)
server/routes.ts         # Route coordinator + batch scheduler + job queue init
server/middleware/       # Per-user rate limiting, application-level WAF
client/src/lib/i18n.ts   # i18n system (English + Spanish)
server/storage.ts        # Storage abstraction (PostgreSQL, S3, or in-memory backends)
server/storage-postgres.ts # PostgreSQL IStorage implementation (~30 methods)
server/auth.ts           # Authentication middleware + session management (PostgreSQL or memory store)
shared/schema.ts         # Zod schemas shared between client/server
tests/                   # Unit tests (Node test runner)
```

### Audio Processing Pipeline (server/routes.ts → processAudioFile)

**Signature (A22)**: `processAudioFile(callId: string, audio: Buffer, options: ProcessAudioOptions)`. The options object carries `originalName`, `mimeType`, `callCategory?`, `uploadedBy?`, `processingMode?`, `language?`, `filePath?`. Legacy 9-positional signature removed.

1. Archive audio to S3 immediately on upload (before queuing)
2. Enqueue job in PostgreSQL job queue (falls back to in-memory TaskQueue if no DB)
3. Job worker reads audio from S3 and sends to AssemblyAI for transcription (webhook mode if `APP_BASE_URL` set, polling fallback otherwise)
3b. **Empty transcript guard**: if transcript has <10 meaningful characters, skip AI analysis (prevents wasted Bedrock spend)
4. Load custom prompt template by call category (falls back to default if template fails)
5. Send transcript to Bedrock for AI analysis (falls back to transcript-based defaults if Bedrock fails)
6. Process results: normalize data, compute confidence scores, detect agent name, set flags
7. Store transcript, sentiment, and analysis to storage (PostgreSQL or S3)
8. Auto-assign call to employee if agent name detected
9. Auto-categorize call if AI returns a category and none was provided at upload
10. Trigger coaching alerts for low-score (<=4) or high-score (>=9) calls

**Job Queue** (when PostgreSQL is configured):
- Durable: jobs survive server restarts
- Uses `SELECT ... FOR UPDATE SKIP LOCKED` for safe concurrent processing
- Configurable concurrency via `JOB_CONCURRENCY` env var (default 5)
- Auto-retry with dead-letter pattern (3 max attempts)
- Heartbeat: workers emit `last_heartbeat_at` every 30s during job execution; `reapStaleJobs()` fails any 'running' job with a heartbeat older than 2 minutes. Attempts increment only on explicit failJob (including via reap) — worker crashes no longer burn retries on their own (A18).

**Batch Inference Mode** (when `BEDROCK_BATCH_MODE=true`):
- After transcription, the AI analysis prompt is saved to S3 (`batch-inference/pending/`) instead of calling Bedrock synchronously
- A scheduler runs every `BATCH_INTERVAL_MINUTES` (default 15), collects pending items, creates a JSONL input file, and submits to Bedrock Batch API
- Submitted jobs are tracked via `batch-inference/active-jobs/${jobId}.json`. Post-submission tracking writes are retried 3× with exponential backoff; on persistent failure the tracking data falls back to `batch-inference/orphaned-submissions/${jobId}.json` and a `logger.error` alert is raised with the jobId/jobArn recovery keys. The next batch cycle's `promoteOrphanedSubmissions()` scan self-heals the orphan back to `active-jobs/`.
- Bedrock processes the batch asynchronously at 50% cost vs on-demand pricing (completion within 24 hours)
- On completion, results are parsed from S3 output, analyses are stored, and calls are moved to "completed" status
- Requires IAM role with `bedrock:CreateModelInvocationJob` and `bedrock:GetModelInvocationJob` permissions
- Falls back to on-demand if batch submission fails

**On failure**: Call status set to "failed", WebSocket notifies client. Job queue retries up to 3 times before marking as "dead". Error messages are logged without full stack traces (HIPAA — avoids logging PHI).

### AI Analysis Data Flow
- Bedrock returns JSON with: summary, topics[], sentiment, performance_score, sub_scores, action_items[], feedback{strengths[], suggestions[]}, flags[], detected_agent_name
- `ai-provider.ts` builds the prompt (with custom template support) and parses JSON response
- `assemblyai.ts:processTranscriptData()` normalizes AI output into storage format
- **Important**: AI may return objects instead of strings in arrays — server normalizes with `normalizeStringArray()`, frontend has `toDisplayString()` safety

### Storage Backend Selection (server/storage.ts)
1. `DATABASE_URL` env var → **PostgresStorage** (metadata in RDS, audio in S3) — **recommended for production**
2. `STORAGE_BACKEND=s3-legacy` → **CloudStorage** (deprecated, all data as JSON in S3 — emits a startup WARN). The old `STORAGE_BACKEND=s3` value now throws at boot.
3. Neither → **MemStorage** (in-memory, non-persistent — dev only)

## API Routes Overview

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (returns `{ status, timestamp }`) |
| GET | `/api/config` | Public app config — `companyName` + scoring tier thresholds. Used by the login page and sidebar before auth. |
| POST | `/api/auth/login` | Login (rate limited: 5 attempts/15min per IP) |
| POST | `/api/auth/logout` | Logout & clear session |
| GET | `/api/auth/me` | Get current user |

### MFA (authenticated)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/auth/mfa/status` | authenticated | Returns `{ enabled, required, recoveryCodesRemaining }` |
| POST | `/api/auth/mfa/setup` | authenticated | Generate TOTP secret + otpauth URI |
| POST | `/api/auth/mfa/enable` | authenticated | Verify TOTP code and enable MFA. Returns `{ message, recoveryCodes: string[] }` — plaintext codes shown exactly once |
| POST | `/api/auth/mfa/recovery-codes/regenerate` | authenticated | Generate a fresh set of single-use recovery codes (invalidates any prior codes). Returns `{ recoveryCodes: string[] }` — plaintext shown once |
| POST | `/api/auth/mfa/disable` | authenticated | Disable MFA (admin can disable for others) |
| GET | `/api/auth/mfa/users` | admin | List all MFA-enabled users |

### Access Requests
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/access-requests` | public | Submit access request |
| GET | `/api/access-requests` | admin | List all requests |
| PATCH | `/api/access-requests/:id` | admin | Approve/deny request |

### Calls
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/calls` | authenticated (viewer: own calls only) | List calls. Viewers have employee filter forced to their linked employee ID; unlinked viewers get empty results. |
| GET | `/api/calls/:id` | authenticated (viewer: own calls only) | Get call details. Viewers get 403 on other employees' calls. |
| POST | `/api/calls/upload` | authenticated | Upload audio (starts pipeline) |
| GET | `/api/calls/:id/audio` | authenticated (viewer: own calls only) | Stream audio for playback |
| GET | `/api/calls/:id/transcript` | authenticated (viewer: own calls only) | Get transcript |
| GET | `/api/calls/:id/sentiment` | authenticated (viewer: own calls only) | Get sentiment analysis |
| GET | `/api/calls/:id/analysis` | authenticated (viewer: own calls only) | Get AI analysis |
| PATCH | `/api/calls/:id/analysis` | manager+ | Edit AI analysis |
| PATCH | `/api/calls/:id/assign` | manager+ | Assign call to employee |
| DELETE | `/api/calls/:id` | manager+ | Delete call |
| GET | `/api/calls/:id/tags` | authenticated (viewer: own calls only) | Get tags for a call |
| POST | `/api/calls/:id/tags` | authenticated | Add a tag to a call |
| DELETE | `/api/calls/:id/tags/:tagId` | authenticated | Remove a tag from a call |
| GET | `/api/tags` | authenticated | Get all unique tags (for autocomplete) |
| GET | `/api/calls/by-tag/:tag` | authenticated (viewer: own calls only) | Search calls by tag |
| GET | `/api/calls/:id/annotations` | authenticated (viewer: own calls only) | Get annotations for a call |
| POST | `/api/calls/:id/annotations` | authenticated | Add annotation to a call |
| DELETE | `/api/calls/:id/annotations/:annotationId` | authenticated | Remove an annotation |

### Employees
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/employees` | authenticated | List all employees |
| GET | `/api/employees/teams` | authenticated | Server-defined department / sub-team taxonomy (replaces hardcoded client constant) |
| POST | `/api/employees` | manager+ | Create employee |
| PATCH | `/api/employees/:id` | manager+ | Update employee |
| POST | `/api/employees/import-csv` | admin | Bulk import from CSV |

### Dashboard & Reports
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard/metrics` | authenticated | Call metrics & performance |
| GET | `/api/dashboard/sentiment` | authenticated | Sentiment summaries |
| GET | `/api/dashboard/performers` | authenticated | Top performers |
| GET | `/api/dashboard/weekly-changes` | manager+ | Week-over-week narrative: top score movers, flag deltas, noteworthy calls. Backs the "This Week in Review" dashboard widget. |
| GET | `/api/search` | authenticated (viewer: own calls only) | Full-text search |
| GET | `/api/performance` | manager+ | Performance metrics |
| GET | `/api/reports/summary` | manager+ | Summary report |
| GET | `/api/reports/filtered` | authenticated | Filtered reports (query: `from`, `to`, `employeeId`, `role` (preferred) or `department` (deprecated alias), `callPartyType`). Viewers have `employeeId` forced to their linked employee; unlinked viewers get an empty-shaped response. |
| GET | `/api/reports/agent-profile/:id` | authenticated (viewer: self only) | Detailed agent profile |
| POST | `/api/reports/agent-summary/:id` | authenticated (viewer: self only) | Generate agent summary |
| POST | `/api/reports/export-beacon` | authenticated | HIPAA audit beacon — fired by the client before a TXT/CSV download so client-built exports still land in the audit log |
| GET | `/api/scoring-corrections/mine` | authenticated | Returns the current user's recent scoring corrections + rolling stats (upgrade/downgrade split, avg delta). Query: `days` (default 30, max 365), `limit` (default 20, max 100). Read-only; no MFA gate (reveals no new PHI). Powers the MyCorrectionsCard widget on my-performance. |

### Coaching & Admin
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/coaching` | manager+ | List coaching sessions |
| GET | `/api/coaching/employee/:id` | manager+ | Coaching for employee |
| POST | `/api/coaching` | manager+ | Create coaching session |
| PATCH | `/api/coaching/:id` | manager+ | Update coaching session |
| PATCH | `/api/coaching/:id/action-item/:index` | authenticated | Toggle action item (agents can toggle their own) |
| GET | `/api/coaching/:id/outcome` | manager+ | Coaching effectiveness: compares N calls before vs after the session. Query: `n` (default 10, range 1-50). Returns avg scores, sub-score deltas, `insufficientData` flag when either window has <3 calls. |
| GET | `/api/prompt-templates` | admin | List prompt templates |
| POST | `/api/prompt-templates` | admin | Create prompt template |
| PATCH | `/api/prompt-templates/:id` | admin | Update prompt template |
| DELETE | `/api/prompt-templates/:id` | admin | Delete prompt template |
| POST | `/api/prompt-templates/:id/test` | admin | Back-test a candidate template against the last 1-10 completed calls in its category. Runs real Bedrock analyses; results are NOT persisted and do NOT affect metrics, coaching, or gamification. |
| GET | `/api/insights` | manager+ | Aggregate insights & trends (query: `days`, default 90, max 365) |
| GET | `/api/admin/queue-status` | admin | Job queue stats (pending, running, completed, failed) |
| GET | `/api/admin/jobs/:id` | admin | Generic job status lookup (used by batch snapshot polling) |
| GET | `/api/admin/dead-jobs` | admin | List dead-letter jobs (failed after max retries) |
| POST | `/api/admin/dead-jobs/:id/retry` | admin | Retry a dead-letter job |
| GET | `/api/admin/reports` | manager+ | List generated weekly/monthly scheduled reports |
| GET | `/api/admin/reports/:id` | manager+ | Get a single scheduled report (DB lookup on cache miss) |
| POST | `/api/admin/reports/generate` | manager+ | Manually generate a weekly or monthly report |
| GET | `/api/admin/metrics` | admin | Runtime counters + histograms (Prometheus-style) |
| GET | `/api/admin/health-deep` | admin | Aggregated operational health: audit log, job queue, Bedrock circuit breaker, RAG cache, batch inference, scoring quality + regression alerts, calibration, telephony |
| GET | `/api/admin/batch-status` | admin | Bedrock batch inference status (pending items, active jobs) |
| GET | `/api/admin/security-summary` | admin | Security posture summary |
| GET | `/api/admin/security-alerts` | admin | Recent security alerts |
| PATCH | `/api/admin/security-alerts/:id` | admin | Acknowledge a security alert |
| GET | `/api/admin/breach-reports` | admin | List all HIPAA breach reports |
| POST | `/api/admin/breach-reports` | admin | File a new breach report |
| PATCH | `/api/admin/breach-reports/:id` | admin | Update breach notification status |
| GET | `/api/admin/waf-stats` | admin | WAF statistics and blocked IPs |
| POST | `/api/admin/waf/block-ip` | admin | Manually block an IP address |
| POST | `/api/admin/waf/unblock-ip` | admin | Unblock an IP address |
| GET | `/api/admin/vuln-scan/latest` | admin | Latest vulnerability scan report |
| GET | `/api/admin/vuln-scan/history` | admin | All scan history |
| POST | `/api/admin/vuln-scan/run` | admin | Trigger manual vulnerability scan |
| POST | `/api/admin/vuln-scan/accept/:findingId` | admin | Accept a finding as risk |
| GET | `/api/admin/incidents` | admin | List all security incidents |
| GET | `/api/admin/incidents/:id` | admin | Get incident details |
| POST | `/api/admin/incidents` | admin | Declare a new security incident |
| POST | `/api/admin/incidents/:id/advance` | admin | Advance incident to next phase |
| POST | `/api/admin/incidents/:id/timeline` | admin | Add timeline entry to incident |
| PATCH | `/api/admin/incidents/:id` | admin | Update incident details |
| POST | `/api/admin/incidents/:id/action-items` | admin | Add action item to incident |
| PATCH | `/api/admin/incidents/:incidentId/action-items/:itemId` | admin | Update action item status |
| GET | `/api/admin/incident-response-plan` | admin | Get escalation contacts and response procedures |
| GET | `/api/admin/calibration` | admin | Latest score calibration snapshot |
| POST | `/api/admin/calibration/analyze` | admin | Trigger manual calibration analysis (query: `days`) |
| POST | `/api/admin/calibration/apply` | admin | Apply recommended calibration values (guard rail: ±0.5 max shift) |
| GET | `/api/admin/telephony/status` | admin | 8x8 telephony integration status |
| GET | `/api/admin/pipeline-settings` | admin | Current effective quality-gate thresholds + per-field source (default / env / override) |
| PATCH | `/api/admin/pipeline-settings` | admin | Override quality-gate thresholds (minCallDurationSec, minTranscriptLength, minTranscriptConfidence). Pass `null` on a field to clear the override. Persists to S3 (`config/pipeline-settings.json`). |
| GET | `/api/admin/model-tiers` | admin | Current Anthropic model IDs per tier (strong/fast/reasoning) with source metadata (override / env / legacy-env / default). |
| PATCH | `/api/admin/model-tiers` | admin | Set or clear a per-tier Bedrock model override. Body: `{ tier: "strong"\|"fast"\|"reasoning", model: string\|null, reason?: string }`. Setting "strong" also calls `aiProvider.setModel()` + `bedrockBatchService.setModel()`. Persists to S3 (`config/model-tiers.json`). |

### User Management (admin only)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/users` | admin | List all users |
| POST | `/api/users` | admin | Create user |
| PATCH | `/api/users/:id` | admin | Update user (role, display name, active) |
| DELETE | `/api/users/:id` | admin | Deactivate user (soft delete) |
| POST | `/api/users/:id/reset-password` | admin | Admin reset user password |
| PATCH | `/api/users/me/password` | authenticated | Self-service password change |

### Team Analytics & Export
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/analytics/teams` | authenticated | Comparative team performance (sub-team aggregates) |
| GET | `/api/analytics/team/:teamName` | manager+ | Individual employee metrics within a team |
| GET | `/api/analytics/trends` | authenticated | Week-over-week/month-over-month company-wide trends |
| GET | `/api/analytics/trends/agent/:employeeId` | authenticated (viewer: self only) | Agent-specific performance trends |
| GET | `/api/analytics/speech/:callId` | authenticated (viewer: own calls only) | Speech metrics for a single call (interruptions, latency, talk time) |
| GET | `/api/analytics/speech-summary` | manager+ | Aggregate speech metrics across agents (query: `days`) |
| GET | `/api/analytics/heatmap` | authenticated (viewer: self only) | Day-of-week × hour-of-day call volume + avg score grid (query: `days`, `employee`). Viewers have `employee` filter forced to self; unlinked viewers get an empty 7×24 grid. |
| GET | `/api/analytics/clusters` | authenticated (viewer: self only) | Topic clusters via TF-IDF cosine similarity (query: `days`, `employee`, `minSize`). Viewers have `employee` filter forced to self; unlinked viewers get an empty clusters array. |
| GET | `/api/analytics/compare` | manager+ | Compare 2-5 agents side-by-side (query: `ids` comma-separated employee IDs) |
| GET | `/api/analytics/health-pulse/:employeeId` | authenticated (viewer: self only) | Compares current N-day window vs prior equal-length window. Returns `{ current, prior, overallDelta, trend, severity, subScores }`. Query: `days` (default 28, range 7–90). Powers the Health Pulse widget on agent-scorecard. |
| GET | `/api/export/calls` | manager+ | Export calls as CSV (with date/employee filters) |
| GET | `/api/export/team-analytics` | manager+ | Export team analytics as CSV |

### Performance Snapshots (periodic reviews)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/api/snapshots/employee/:id` | manager+ | Generate employee performance snapshot |
| POST | `/api/snapshots/team` | manager+ | Generate team performance snapshot |
| POST | `/api/snapshots/department` | manager+ | Generate department performance snapshot |
| POST | `/api/snapshots/company` | manager+ | Generate company-wide performance snapshot |
| POST | `/api/snapshots/batch` | admin | Batch generate all employee + team + company snapshots |
| GET | `/api/snapshots/employee/:id` | authenticated (viewer: self only) | Get employee snapshot history |
| GET | `/api/snapshots/team/:teamName` | authenticated | Get team snapshot history |
| GET | `/api/snapshots/department/:dept` | authenticated | Get department snapshot history |
| GET | `/api/snapshots/company` | authenticated | Get company-wide snapshot history |
| GET | `/api/snapshots/all/:level` | manager+ | Get all snapshots for a level |
| DELETE | `/api/snapshots/:level/:targetId/reset` | admin | AI Context Reset — clear all snapshots for a target |

### Webhooks (admin only)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/webhooks` | admin | List all webhook configurations |
| POST | `/api/webhooks` | admin | Create webhook (URL, events, secret for HMAC) |
| PATCH | `/api/webhooks/:id` | admin | Update webhook |
| DELETE | `/api/webhooks/:id` | admin | Delete webhook |

### A/B Model Testing (admin only)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/ab-tests` | admin | List all A/B tests |
| GET | `/api/ab-tests/:id` | admin | Get test details (both analyses) |
| GET | `/api/ab-tests/aggregate` | admin | Groups completed A/B tests by (baseline, test) model pair. Returns summary stats (avg scores, score delta, latency delta, win/loss counts) and a recommendation (`promote_test` / `keep_baseline` / `inconclusive` / `insufficient_data`). |
| POST | `/api/ab-tests/upload` | admin | Upload audio + specify test model → starts comparison |
| POST | `/api/ab-tests/promote` | admin | Promote a test model to production. Validates against `BEDROCK_MODEL_PRESETS` whitelist, calls `aiProvider.setModel()`, persists override to `config/active-model.json` in S3. Writes HIPAA audit entry `ab_test_promote_model`. |
| DELETE | `/api/ab-tests/:id` | admin | Delete a test |

**A/B Test Processing Pipeline** (`server/routes.ts → processABTest`):
1. Upload audio to AssemblyAI → transcribe (same as normal pipeline)
2. Run baseline model (current production Sonnet) and test model in parallel (both timed)
3. Store both analyses + latency to `ab-tests/` S3 prefix
4. WebSocket notifies client on completion

Test calls are stored separately from production data (`ab-tests/{id}.json`), never assigned to employees, and never included in dashboard metrics, reports, or performance scores.

### Simulated Call Generator (admin only, MFA-gated)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/simulated-calls/generate` | Enqueue a generation job. Returns `202 { simulatedCallId, status, dailyUsed, dailyCap }`. Enforces `SIMULATED_CALL_DAILY_CAP` per admin. |
| GET | `/api/admin/simulated-calls` | List generations for the current admin + `dailyUsed` / `dailyCap` fields. |
| GET | `/api/admin/simulated-calls/:id` | Single generation row. |
| GET | `/api/admin/simulated-calls/:id/audio` | Stream the stitched MP3 from S3 (`audio/mpeg`). |
| POST | `/api/admin/simulated-calls/:id/analyze` | Send to the real analysis pipeline. Creates a `synthetic=TRUE` `calls` row with `external_id="sim:<id>"`, enqueues `process_audio`, links back via `simulated_calls.sent_to_analysis_call_id`. Also invoked automatically by the generation job worker when `config.analyzeAfterGeneration === true`. |
| POST | `/api/admin/simulated-calls/:id/rewrite` | Bedrock script rewriter (Phase B). Body: `{ circumstances: Circumstance[] (1–4), targetQualityTier? }`. Returns a PREVIEW of the rewritten script (does NOT persist). Admin confirms by submitting the preview to `/generate`. Cost: ~$0.003 on Haiku / ~$0.034 on Sonnet per rewrite. |
| DELETE | `/api/admin/simulated-calls/:id` | Delete generation + best-effort S3 audio cleanup. |
| GET | `/api/admin/simulated-calls/voices` | Cached (24h) ElevenLabs voice-list proxy. |

### Usage / Spend Tracking (admin only)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/usage` | admin | List all usage records with estimated costs |

Usage records are automatically created after each call analysis and A/B test. Estimated costs are calculated from audio duration (AssemblyAI) and token counts (Bedrock). Stored under `usage/` S3 prefix. The admin Spend Tracking page shows current month, last month, YTD, and all-time views with charts.

### Gamification (authenticated)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/gamification/leaderboard` | authenticated | Agent leaderboard (query: `period=week\|month\|all`) |
| GET | `/api/gamification/badges/:employeeId` | authenticated (viewer: self only) | Badges earned by an employee |
| GET | `/api/gamification/badge-types` | authenticated | All possible badge definitions |
| GET | `/api/gamification/stats/:employeeId` | authenticated (viewer: self only) | Points, streak, and badges for one agent |

**Gamification System** (`server/services/gamification.ts`):
- **Badges**: 12 types — milestone (first call, 25/50/100 calls), score (perfect 10), streak (3/5/10 consecutive 8+), sub-score (compliance star, empathy champion, resolution ace), improvement (most improved over 30 days)
- **Points**: Base 10 per call + score bonus (score × 10) + streak multiplier (1.5× if streak ≥ 3) + badge bonus (50 per new badge earned on that call)
- **Streaks**: Consecutive calls scoring ≥ 8.0 (resets on any call < 8.0)
- **Leaderboard**: Period-filtered rankings (week/month/all time) with points, avg score, call count, streak, badges
- **Pipeline integration**: `evaluateBadges()` runs non-blocking at the end of `processAudioFile()` after coaching alerts
- **Storage**: PostgreSQL `badges` table with unique constraint on milestone badge types per employee; S3/memory fallback supported
- **Minimal overhead**: Badge evaluation queries only the employee's recent calls — no global scans

## Role-Based Access Control

Role hierarchy: **admin (3) > manager (2) > viewer (1)**. Enforced via `requireRole()` middleware in `server/auth.ts`.

| Role | Capabilities |
|------|-------------|
| **viewer** | Read-only, scoped to own data: own calls (list + details + transcript/sentiment/analysis/audio), own agent profile/badges/stats/trends/health-pulse/snapshots. Company dashboards (non-agent-specific) visible to all viewers. |
| **manager** | Everything viewer can do, plus: assign calls, edit AI analysis, manage employees, create coaching sessions, export reports, delete calls |
| **admin** | Full control: manage users, approve/deny access requests, bulk CSV import, prompt template CRUD, A/B model testing, spend tracking, system configuration |

Access requests can request "viewer" or "manager" roles (not admin).

## Environment Variables
```
# Required
ASSEMBLYAI_API_KEY              # Transcription service
SESSION_SECRET                  # Cookie signing

# Simulated Call Generator (admin-only QA tool — optional feature)
ELEVENLABS_API_KEY              # ElevenLabs TTS API key (required to use the feature)
ELEVENLABS_COST_PER_CHAR        # Override per-char cost for spend tracking (default: 0.0003 = $0.30/1K chars)

# Authentication (PostgreSQL users table is primary; AUTH_USERS env var is fallback)
AUTH_USERS                      # Format: user:pass:role:name,user2:pass2:role2:name2 (fallback if no DB users)

# AWS (for Bedrock AI + S3 storage)
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION                      # Default: us-east-1
AWS_SESSION_TOKEN               # Optional, for IAM roles

# PostgreSQL Database (recommended for production)
DATABASE_URL                    # postgresql://user:password@host:5432/dbname
                                # Enables: PostgresStorage, durable sessions, job queue, audit log table

# Storage
S3_BUCKET                       # Default: ums-call-archive (audio blobs when DB is set, everything when DB is not)

# AI Model — tiered (see server/services/model-tiers.ts)
BEDROCK_MODEL_STRONG            # Primary analysis model (Sonnet-class). Default: us.anthropic.claude-sonnet-4-6
BEDROCK_MODEL_FAST              # Cost-optimized model (Haiku-class). Default: us.anthropic.claude-haiku-4-5-20251001
BEDROCK_MODEL_REASONING         # Reasoning model (Opus-class). Default: us.anthropic.claude-opus-4-7 — reserved, nothing reads it today
BEDROCK_MODEL                   # LEGACY: alias for BEDROCK_MODEL_STRONG (still respected, new deploys should use the tier-specific var)
BEDROCK_HAIKU_MODEL             # LEGACY: alias for BEDROCK_MODEL_FAST
BEDROCK_TIMEOUT_MS              # Bedrock Converse API timeout in ms (default: 120000 / 2 min)
BEDROCK_EMBEDDING_TIMEOUT_MS    # Bedrock embedding API timeout in ms (default: 15000 / 15 sec)
ASSEMBLYAI_POLL_MAX_MINUTES     # Max minutes to poll AssemblyAI before timeout (default: 5)

# Batch Inference (50% cost savings, delayed results)
BEDROCK_BATCH_MODE              # Set to "true" to enable batch inference (default: disabled)
BEDROCK_BATCH_ROLE_ARN          # IAM role ARN for Bedrock batch jobs (required if batch mode enabled)
BATCH_INTERVAL_MINUTES          # How often to submit/check batch jobs (default: 15)
BATCH_SCHEDULE_START            # Time-of-day to START using batch mode (24h format, e.g. "18:00")
BATCH_SCHEDULE_END              # Time-of-day to STOP using batch mode (24h format, e.g. "08:00")
                                # When both set: batch during window, immediate outside. Uploads can override per-call.

# MFA (Two-Factor Authentication)
REQUIRE_MFA                     # Set to "true" to enforce TOTP MFA for all users (default: disabled)

# Company Branding
COMPANY_NAME                    # Company name for snapshots, coaching prompts, transcription word boost (default: "UMS (United Medical Supply)")

# AssemblyAI Webhooks (faster than polling)
APP_BASE_URL                    # Public URL of the app (e.g. https://umscallanalyzer.com) — enables webhook mode for AssemblyAI
ASSEMBLYAI_WEBHOOK_SECRET       # Shared secret for verifying AssemblyAI webhook signatures (REQUIRED in production if APP_BASE_URL is set)
ASSEMBLYAI_WEBHOOK_ALLOW_UNVERIFIED  # Dev-only override: set to "true" to accept AssemblyAI webhooks when ASSEMBLYAI_WEBHOOK_SECRET is not set. Default is deny in all environments.

# RAG Knowledge Base (ums-knowledge-reference integration)
RAG_SERVICE_URL                 # URL of the knowledge reference API (e.g., http://localhost:3001)
RAG_ENABLED                     # Set to "true" to enable RAG context injection (default: disabled)
RAG_API_KEY                     # API key for service-to-service auth (X-API-Key header, min 32 chars)
RAG_CACHE_TTL_MIN               # RAG cache TTL in minutes (default: 30)
RAG_CACHE_SIZE                  # Max RAG cache entries (default: 50)

# Best Practice Auto-Ingestion (sends exceptional calls to KB as reference docs)
BEST_PRACTICE_INGEST_ENABLED    # Set to "true" to auto-ingest exceptional calls (≥9.0) to KB (default: disabled)

# OpenTelemetry Distributed Tracing
OTEL_ENABLED                    # Set to "true" to enable tracing (default: disabled)
OTEL_EXPORTER_OTLP_ENDPOINT    # OTLP collector endpoint (default: http://localhost:4318)
OTEL_SERVICE_NAME               # Service name in traces (default: callanalyzer)
OTEL_ENVIRONMENT                # Deployment environment tag (default: NODE_ENV value)

# Auto-Calibration
CALIBRATION_INTERVAL_HOURS      # How often to run score distribution analysis (default: 24)
CALIBRATION_WINDOW_DAYS         # Days of call data to analyze for calibration (default: 30)

# 8x8 Telephony Integration
TELEPHONY_8X8_ENABLED           # Set to "true" to enable auto-ingestion from 8x8 (default: disabled)
TELEPHONY_8X8_API_KEY           # 8x8 Work API key
TELEPHONY_8X8_SUBACCOUNT_ID     # 8x8 subaccount ID
TELEPHONY_8X8_POLL_MINUTES      # How often to poll for new recordings (default: 15)
TELEPHONY_8X8_STUB_ACKNOWLEDGED # Required ack flag (A1) — without this, scheduler refuses to start even if TELEPHONY_8X8_ENABLED=true
TELEPHONY_8X8_BASE_URL          # 8x8 API base URL (override for testing)

# Pipeline quality gates (A24)
MIN_CALL_DURATION_FOR_AI_SEC    # Minimum seconds of audio to run AI analysis (default: 15)
MIN_TRANSCRIPT_LEN_FOR_AI       # Minimum transcript char count (default: 10)
MIN_TRANSCRIPT_CONFIDENCE_FOR_AI # Minimum transcript confidence to run AI (default: 0.6)
HAIKU_SHORT_CALL_MAX_SEC        # Short-call Haiku optimization threshold in seconds (default: 120)
HAIKU_SHORT_CALL_MAX_TOKENS     # Token cap for Haiku short-call eligibility (default: 3000)

# Gamification / coaching (A41 — all env-overridable, NaN-guarded)
STREAK_SCORE_THRESHOLD          # Minimum score to count toward streak (default: 8.0)
WEAKNESS_CALL_THRESHOLD         # Recent low sub-score count to trigger coaching plan (default: 3)
WEAKNESS_SCORE_THRESHOLD        # Sub-score considered "weak" (default: 5.0)
LOOKBACK_CALLS                  # Recent-call window for weakness analysis (default: 10)

# Speech metrics (A41)
MONOLOGUE_DURATION_MS           # Single-speaker monologue threshold in ms (default: 60000)
INTERRUPTION_GAP_MS             # Speaker-change gap considered interruption in ms (default: 200)

# Audit Log Integrity (HIPAA §164.312(b))
AUDIT_HMAC_SECRET               # Required in production. Dedicated secret for the audit log HMAC integrity chain. Falls back to SESSION_SECRET in dev only — boot-fails in production if unset.

# Optional
PORT                            # Default: 5000
RETENTION_DAYS                  # Auto-purge calls older than N days (default: 90)
JOB_CONCURRENCY                 # Max parallel audio processing jobs (default: 5, requires DATABASE_URL)
JOB_POLL_INTERVAL_MS            # How often to check for new jobs (default: 5000, requires DATABASE_URL)

# Logging & Observability
LOG_LEVEL                       # Logging verbosity: debug, info, warn, error (default: info)

# Database
DB_SSL_REJECT_UNAUTHORIZED      # Set to "false" for self-signed certs in dev/staging (IGNORED in production — always true)
STORAGE_BACKEND                 # "s3-legacy" → deprecated CloudStorage with startup WARN. Old "s3" value throws. Default: auto-detected from DATABASE_URL.

# Score Calibration
SCORE_CALIBRATION_ENABLED       # Set to "true" to enable score distribution normalization (default: disabled)
SCORE_CALIBRATION_CENTER        # Distribution center point (default: 5.5, range: 0-10)
SCORE_CALIBRATION_SPREAD        # Distribution spread (default: 1.2, range: 0.1-5.0)
SCORE_AI_MODEL_MEAN             # AI model's natural scoring mean (default: 7.0)

# Redis (optional — enables distributed job queues)
REDIS_URL                       # Redis connection string (e.g., redis://localhost:6379). Without Redis, falls back to PostgreSQL job queue.

# AI Models
BEDROCK_EMBEDDING_MODEL         # Embedding model for call clustering (default: amazon.titan-embed-text-v2:0)
```

## HIPAA Compliance

| Feature | Location | Details |
|---------|----------|---------|
| **Account lockout** | `server/auth.ts` | 5 failed login attempts → 15-min lockout per IP/username |
| **Audit logging** | `server/services/audit-log.ts` | Dual-write: stdout JSON logs (`[HIPAA_AUDIT]`) + PostgreSQL `audit_log` table (6-year retention) |
| **API access audit** | `server/index.ts` | Middleware logs all API calls with user, method, status, duration |
| **Rate limiting** | `server/index.ts` | Login: 5/15min per IP. Generic limiter on sensitive paths |
| **CSP headers** | `server/index.ts` | Content-Security-Policy restricts to same-origin + trusted CDNs |
| **Security headers** | `server/index.ts` | X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, Referrer-Policy, Permissions-Policy |
| **Durable sessions** | `server/auth.ts` | PostgreSQL session store via `connect-pg-simple` (survives restarts) |
| **Session timeout** | `server/auth.ts` | 15-min idle timeout (rolling) + 8-hour absolute max |
| **Secure cookies** | `server/auth.ts` | httpOnly, sameSite=lax, secure in production |
| **HTTPS enforcement** | `server/index.ts` | HTTP → HTTPS redirect in production |
| **Data retention** | `server/index.ts` | Auto-purges calls older than `RETENTION_DAYS` (default 90) |
| **Error logging** | `server/routes.ts` | Logs error messages only, never full stacks (avoids PHI leakage) |
| **MFA (TOTP)** | `server/services/totp.ts` | Optional TOTP two-factor authentication (RFC 6238); timing-safe code verification via `timingSafeEqual`; enforced via `REQUIRE_MFA=true` |
| **Password complexity** | `server/auth.ts` | Rejects weak passwords (12+ chars, uppercase, lowercase, digit, special char) — enforcement on AUTH_USERS, DB user creation, and password reset |
| **Session fingerprinting** | `server/auth.ts` | Binds sessions to user-agent + accept-language (IP intentionally excluded to avoid false kills on mobile/VPN); set on first authenticated request; destroys session on mismatch |
| **Webhook secret enforcement** | `server/routes.ts` | AssemblyAI webhook endpoint rejects unverified payloads by default in ALL environments when `ASSEMBLYAI_WEBHOOK_SECRET` is not set. Dev override: `ASSEMBLYAI_WEBHOOK_ALLOW_UNVERIFIED=true`. Secret compare uses SHA-256 + timingSafeEqual. |
| **SSRF protection** | `server/services/url-validator.ts` | Shared URL validator: blocks localhost, private/reserved IPs (RFC 1918/6598), cloud metadata endpoints (AWS/GCP/Azure/Alibaba), .local/.internal hostnames, IPv6-mapped IPv4, DNS resolution to private IPs; enforces HTTPS in production; applied to webhook create, update, and delivery |
| **Startup env validation** | `server/index.ts` | Critical config (`SESSION_SECRET`, API keys, `DATABASE_URL`) validated at boot with clear warnings/errors |
| **CSRF protection** | `server/index.ts` | JSON requests require `Content-Type: application/json`; file uploads require `X-Requested-With` header; both prevent cross-origin form submissions |
| **Admin action audit** | `server/routes/admin-*.ts` | WAF IP block/unblock and dead-job retry actions logged to HIPAA audit trail |
| **Error sanitization** | `server/services/bedrock.ts` | Bedrock API errors logged server-side with details; client receives sanitized category only (no AWS account IDs, ARNs, or model details) |
| **Breach notification** | `server/services/security-monitor.ts` | HIPAA §164.408 breach reporting with timeline tracking, notification status |
| **Security monitoring** | `server/services/security-monitor.ts` | Detects distributed brute-force, credential stuffing, bulk data exfiltration |
| **Read rate limiting** | `server/index.ts` | 60 req/min on data endpoints; 5 req/min on exports (prevents bulk exfiltration) |
| **WAF** | `server/middleware/waf.ts` | Application-level firewall split into two passes: `wafPreBody` (runs before `express.json()` — inspects IP/UA/URL/query/path) and `wafPostBody` (runs after parsing — inspects `req.body`, no-ops on multipart). SQL injection, XSS, path traversal, CRLF, IP blocklist with LRU-bounded anomaly scoring; NFC + HTML entity decode normalization; input truncated to 4KB to prevent regex DoS. Legacy `wafMiddleware()` is deprecated. |
| **Audit log integrity** | `server/services/audit-log.ts` | HMAC-SHA256 chain on stdout entries — each hash covers content + previous hash; chain head persisted to `audit_log_integrity` singleton table and restored on startup via `loadAuditIntegrityChain()` so deploys/restarts don't break verification; tampering/deletion still breaks the chain. Uses dedicated `AUDIT_HMAC_SECRET` (required in production) |
| **TOTP replay protection** | `server/services/totp.ts` | Used-token cache prevents same TOTP code from being reused within the same time window |
| **Route param validation** | `server/routes/utils.ts` | `validateParams()` middleware rejects malformed UUIDs, IDs, and names before they reach DB queries (30+ routes) |
| **Audit log durability** | `server/services/audit-log.ts` | Write-ahead queue (`MAX_QUEUE_SIZE=20000`, ~20MB runway) with batched INSERT (up to 100 rows/flush, 2s interval), strict-FIFO drain from queue head, per-row fallback on batch failure, retry with exponential backoff, graceful shutdown flush, health endpoint monitoring. Overflow policy: drop-OLDEST (canonical record remains in stdout HMAC chain). First drop per process escalates via `logger.error`; subsequent drops in the same process are also logged via `logger.error` but do not re-alert. |
| **Graceful shutdown** | `server/index.ts` | SIGINT/SIGTERM sequence: (1) `server.close()` stops accepting new connections, (2) stop schedulers (batch, calibration, telephony, reports, transcribing-reaper) — each with independent try/catch, (3) `jobQueue.stop()` drains in-flight pipeline jobs (15s cap), (3a) `persistIntegrityChainHead()` persists HMAC chain head to DB, (4) audit log queue flush (10s cap), (5) DB pool close. 30s outer hard-exit timeout via `setTimeout().unref()`. |
| **Vulnerability scanning** | `server/services/vulnerability-scanner.ts` | Automated daily scans of env config, dependencies, database, auth; admin can trigger manual scans |
| **Incident response** | `server/services/incident-response.ts` | Formal IRP with severity classification, phase tracking, escalation contacts, response procedures, action items |
| **Disaster recovery** | `docs/disaster-recovery.md` | DR plan: S3 CRR, RDS cross-region replica, AMI snapshots, Route 53 DNS failover |
| **PHI redaction in logs** | `server/services/phi-redactor.ts`, `shared/phi-patterns.ts` | 14 regex patterns (SSN, DOB, MRN, phone, email, address, Medicare/Medicaid IDs, names) auto-redact the `detail` field in all audit entries before persistence. `shared/phi-patterns.ts` is the single source of truth shared between server audit/logger. |
| **Client export audit beacon** | `server/routes/reports.ts` (`POST /api/reports/export-beacon`), `client/src/pages/reports.tsx:sendExportBeacon` | Client-built TXT/CSV report exports POST a beacon before download; the beacon writes `event: "export_report_clientside"` via `logPhiAccess`. Best-effort — a failed beacon does not block the user-initiated download. Full server-side export is the long-term fix (roadmap). |
| **Prompt injection detection** | `server/services/prompt-guard.ts` | 16 input patterns + output anomaly detection scan transcripts before Bedrock analysis; flags calls but doesn't block (spoken injection is a real attack vector) |
| **Circuit breaker** | `server/services/resilience.ts` | Wraps all Bedrock calls; 5 failures → open for 30s → half-open test; prevents job queue from hammering a down service |
| **Idle timeout warning** | `client/src/hooks/use-idle-timeout.ts` | 2-minute countdown dialog before auto-logout at 15 min idle; any activity resets timer. **Fail-closed** (A16): if the logout callback throws, the hook hard-redirects to `/auth` instead of swallowing the error. |
| **Double-submit CSRF** | `server/index.ts` | SameSite=Strict cookie + X-CSRF-Token header verification on state-changing requests; supplements Content-Type check |
| **Password history** | `server/auth.ts`, `server/storage-postgres.ts` | Prevents reuse of last 5 passwords on self-service change and admin reset |
| **Correlation IDs** | `server/services/correlation-id.ts` | AsyncLocalStorage per-request UUID auto-injected into all structured log entries; X-Request-Id header propagated |
| **OpenTelemetry tracing** | `server/services/tracing.ts` | Distributed tracing with spans on Bedrock analysis, RAG fetch, and text generation; compatible with Jaeger/Tempo/Datadog |
| **SSL hardening** | `server/db/pool.ts` | Production always enforces `rejectUnauthorized: true` regardless of env var override |

## Key Design Decisions
- **`bedrock-batch.ts` credential resolution** (A1): switched from constructor env-var read to `getAwsCredentials()` lazy lookup. Trade-off: first batch operation on an EC2 instance pays an IMDS round-trip (~tens of ms) instead of being instant. Acceptable because batch ops are infrequent and the previous behavior was completely broken on instance profiles.
- **`talkTimeRatio` nullability** (A4): chose explicit `null` over the prior 0.5 default because the field is not currently consumed by any frontend/analytics path; we'd rather store "unknown" honestly than a misleading number. If a consumer is added later, it must handle `null`.
- **Strict CallAnalysisSchema + 1-retry budget** (A12): removed silent Zod defaults for `summary`/`performance_score`/`sub_scores` and added a single pipeline retry on parse failure. Trade-off: malformed AI output now throws + retries (doubling Bedrock cost on parse failure) instead of silently producing placeholder calls. Cleaner DB at the cost of higher cost variance under Bedrock instability.
- **`recommended.spread` removed without route cleanup** (A14): the broken `targetSpread / observedSpread` math was deleted from `CalibrationSnapshot`, but `/api/admin/calibration/apply` still requires `spread` in its request body. Trade-off: snapshot consumers can no longer auto-fill the apply request. Acceptable because no admin UI currently calls apply, but a follow-on cleanup is needed before any UI lands.
- **JobQueue attempts-on-failJob contract** (A18): `attempts` increments only when `failJob` runs — explicit failures and stale-heartbeat reaps. Crashes alone no longer burn attempts. Trade-off: a genuinely unhealthy worker that repeatedly crashes before heartbeat will be caught by the reaper, which burns one attempt per reap; transient DB flapping during reap can exhaust retries on a job that never actually failed.
- **`/api/calls` is cursor-pagination-only** (A20): the legacy offset mode was removed because it loaded the full result set into memory for slicing. `?page=N` requests silently return page 1 rather than 400 — breaks loudly would be better but was deferred to avoid a same-cycle frontend migration.
- **`/api/employees` silent default pagination** (A20): limit=50 default with `X-Pagination-Default: true` header rather than a hard 400 on missing limit. Preserves backward compat at the cost of silent truncation for unmigrated callers.
- **Content hash uniqueness is DB-enforced** (A21): `UNIQUE INDEX idx_calls_content_hash_unique` rejects duplicate uploads at insert time; route handler catches pg 23505 and 409s. Replaces the prior O(n) scan over `getAllCalls`. The unique partial index is defined in BOTH `server/db/schema.sql` (fresh deploys) AND `server/db/pool.ts:runMigrations` (upgrades). Previously lived only in `runMigrations`, which meant fresh deploys had no dedupe guard until the second boot.
- **CSV import contract change** (A29): switched from server-side file read (`./employees.csv`) to multipart upload. Closes a file-write injection hole and ends pm2 working-directory fragility, but breaks any admin automation relying on the old path.
- **Sentry removed** — `server/services/sentry.ts` and `client/src/lib/sentry.ts` now export no-op stubs. Existing callsites compile unchanged. Error tracking migrated to AWS CloudWatch Logs + Alarms (structured JSON logger → CloudWatch agent → metric filters + alarms).
- **WAF pre/post split ordering is load-bearing**: `wafPreBody` → `express.json({limit:"1mb"})` → `wafPostBody`. Moving WAF after body parsing re-introduces the JSON-parse-then-reject DoS amplification. Moving it all before the parser means `req.body` is undefined for body inspection.
- **Shared TaskQueue tradeoff**: `audioProcessingQueue` is one singleton across pipeline/calls/admin-content (was 4 separate `new TaskQueue(3)` instances with independent caps — effective concurrency 12). Consolidation enforces a real 3-slot cap but means A/B tests and normal uploads compete. If A/B testing becomes heavily used, split them back out with named queues.
- **LRU-bounded WAF IP state**: `blockedIPs`, `temporaryBlocks`, `anomalyScores`, `anomalyCooldowns` are capped at 10k entries with LRU eviction. Under sustained >10k unique attacker IPs, the oldest permanent blocks are evicted. If durable blocks at that scale are needed, move to a persistent store (Redis / PostgreSQL).
- **No AWS SDK**: Both S3 and Bedrock use raw REST APIs with manual SigV4 signing — reduces bundle size and avoids SDK dependency overhead, but means signing logic must be maintained manually
- **Hybrid storage**: PostgreSQL for structured metadata (fast queries, JOINs, transactions) + S3 for audio blobs (cheap, durable). Falls back gracefully without DATABASE_URL.
- **Durable job queue**: PostgreSQL-backed with `SELECT ... FOR UPDATE SKIP LOCKED` — survives restarts, supports concurrent workers, auto-retry with dead-letter
- **Custom prompt templates**: Per-call-category evaluation criteria, required phrases, scoring weights
- **Dark mode**: Toggle in settings; chart text fixed via global CSS in index.css (.dark .recharts-*)
- **Hooks ordering**: All React hooks in transcript-viewer.tsx MUST be called before early returns (isLoading/!call guards) — `transcriptSegments`, `searchMatches`, and `goToMatch` are above the guards
- **A/B test isolation**: Test calls stored under `ab-tests/` S3 prefix, completely separate from production `calls/`, `analyses/`, etc. — no risk of contaminating metrics
- **Passport 0.7 compatibility**: `server/auth.ts` patches `Session.prototype.regenerate` to a no-op (connect-pg-simple's implementation crashes Passport). All `req.login()` calls use `{ keepSessionInfo: true }` to preserve session data. `session.save()` is left alone (real save persists to PostgreSQL).
- **Collapsible admin sidebar**: Admin nav section collapses/expands via caret toggle; auto-expands on `/admin/*` pages
- **Glass effect CSS**: Glass intensity (subtle/medium/strong) works by overriding `--card` and `--sidebar` CSS variables with different alpha values per level in `index.css`; requires a background pattern to be visible
- **Schema validation**: `insertEmployeeSchema` enforces `.email()`, status enum (`Active`/`Inactive`), length limits; `insertCoachingSessionSchema` uses category enum; `callCategory` is enum-validated; `assignCallSchema` is shared from `shared/schema.ts` (not duplicated in routes)
- **performanceScore type**: Schema accepts both string and number, normalizes to string via `.transform()` — consistent with DB VARCHAR column and all `parseFloat()` usage
- **AI error classification**: Pipeline distinguishes parse failures (malformed JSON) from provider unavailability — different log levels. Parse failures now trigger a 1-shot Bedrock retry before falling through to the no-AI path (A12).
- **`bedrockProvider.isAvailable` is no longer optimistic** (A8/F07) — previously returned `true` before IMDS was tried. Now returns `false` until env vars are present or `ensureCredentials()` has been called once. On EC2 instance-profile-only deployments, `aiProvider.isAvailable` reports `false` at boot and AI analysis is skipped until something fires `ensureCredentials()`. Eager-resolution at startup is a planned follow-up.
- **`CallAnalysisSchema` no longer silently defaults `summary`/`performance_score`/`sub_scores`** (A12/F17) — malformed AI responses previously produced "completed" calls with placeholder 5.0 scores and `"No summary available"`. Now invalid output throws inside `parseJsonResponse` and the pipeline retries Bedrock once before falling through to the no-AI path. Doubles Bedrock cost on parse failures and consumes 2 circuit-breaker slots per failed call (breaker threshold is 5 — comfortable). Batched calls that previously silently completed with 5.0 placeholders are now marked failed.
- **`CalibrationSnapshot.recommended.spread` is intentionally absent** (A14/F15) — the prior derivation (`targetSpread / observedSpread`) was dimensionally wrong. The field was removed but `POST /api/admin/calibration/apply` still requires `spread` in the body. Operators must supply it manually; no admin UI exists today, so zero current callers.
- **All server logs are structured JSON via `logger.*`** (A10/F18, #3, #4) — the entire server codebase has been migrated from `console.*` to the structured `logger`. Only TWO intentional exceptions remain: (1) `server/vite.ts` uses `console` for CSS-styled dev terminal output that pre-dates logger; (2) `server/services/audit-log.ts:313` writes the canonical `[HIPAA_AUDIT]` stdout line for the HMAC integrity chain — this MUST NOT be migrated because PHI redaction in the logger would corrupt the chain hash. External log scrapers that grep for any bracket prefix (`[BATCH]`, `[JOB_QUEUE]`, `[WEBHOOK]`, `[Webhooks]`, `[OTEL]`, `[SECURITY]`, `[AUTH]`, `[AWS]`, etc.) now match nothing — update CloudWatch metric filters and pm2 grep scripts to match structured JSON fields instead.
- **Fire-and-forget error capture**: Background tasks (embeddings, coaching alerts, badges, webhooks) call `captureException()` (now a no-op stub; errors are logged via `logger.error`)
- **`updateCall` is employeeId-free** (A6/F14): all three storage backends throw if `employeeId` appears in the updates payload. The manager-facing PATCH /api/calls/:id/assign route uses the new `setCallEmployee` method; pipeline auto-assignment uses `atomicAssignEmployee`. Closes a silent-clobber race where status updates would re-write a stale `employee_id` from a prior read.
- **PostgresStorage password history is JS-side** (A3/F02): `updateDbUserPassword` reads the existing history, prepends + slices to 5, and writes it back in a single UPDATE. Replaces an opaque jsonb_array_elements_text aggregation. Trade-off: small lost-update window on concurrent password changes (admin reset racing self-change). Acceptable because concurrent rotations are vanishingly rare.
- **Production requires `S3_BUCKET`** (A1/F03): `createStorage()` throws at boot when `NODE_ENV=production` and `DATABASE_URL` is set but `S3_BUCKET` is not. Replaces a silent-degraded path where audio uploads would fail at runtime instead of at startup.
- **CloudStorage deprecated behind `s3-legacy` opt-in** (A12/F08, F17): the `STORAGE_BACKEND=s3` value now throws at startup; `s3-legacy` activates CloudStorage with a deprecation WARN. The implicit `S3_BUCKET`-only trigger was also removed because it was the same silent-degraded path the deprecation closes. Trade-off: an operator updating a stale `.env` will see boot fail rather than silently activate the deprecated backend — intentional, but requires comms before deploy.
- **`shared/phi-patterns.ts` is the single source of truth for PHI patterns** (A6, consolidated): `server/services/phi-redactor.ts` now imports all 14 regex patterns from `@shared/phi-patterns` instead of maintaining a parallel copy. Adding a new pattern requires updating only `shared/phi-patterns.ts` — server audit logs and logger pick it up automatically.
- **`useConfig()` is async with a fallback flash** (A11/A27, Batch 2): `companyName` and scoring tier thresholds initially render the bundled fallback constant before the `/api/config` query resolves (~50ms). Eliminable by SSR-injecting the config into the initial HTML. Trade-off accepted because the page doesn't gate on these values. Static `DEFAULT_COMPANY_NAME` / `LOW_SCORE_THRESHOLD` in `client/src/lib/constants.ts` are fallbacks only.
- **`useWebSocket` mount-once-per-mount** (A13, Batch 2): `connect()` and `scheduleReconnect()` capture `toast`, `t`, and `queryClient` in refs so the mount effect runs exactly once per mount. Trade-off: adding a new dep to either callback requires capturing it in a ref via a separate `useEffect`, not appending to the `useCallback` dep array. Replaces a failure mode where locale changes recycled the WebSocket and users in non-English locales missed in-flight call updates.
- **`SessionExpiredError` semantic overload** (A12, Batch 2): the class is now thrown for the MFA-step expired case even when there's no logged-in session, because `throwIfResNotOk` routes all 401s through it. Callers should branch on `error.code === "mfa_session_expired"` rather than treat the class as proof of expired session. Should be renamed to `AuthFlowError` in a future cleanup. Class also now carries an optional `code` field and a new `ApiError` class is exported for non-401 structured errors.
- **Score-tier constants: client-side migration complete** (A11, Batch 2): all surveyed sites now import `SCORE_EXCELLENT/GOOD/NEEDS_WORK` from `client/src/lib/constants.ts` — `report-components`, `agent-scorecard` ×2, `calls-table`, `performance`, `team-analytics`, `call-clusters`, `my-performance`, `leaderboard`. The static client constants mirror `server/constants.ts` and are the bundled fallback for `useConfig()`.
- **A/B test promotion updates both on-demand and batch paths** — `promoteActiveModel()` in `server/services/active-model.ts` now calls both `aiProvider.setModel()` AND `bedrockBatchService.setModel()`, wrapped in try/catch so a batch-service throw doesn't block the on-demand promotion. `loadActiveModelOverride()` applies the same dual-update at startup so a persisted override restores both paths. In-flight batch jobs (already submitted to AWS Bedrock) are unaffected — they run to completion on whatever model they were submitted with. Only NEW batch submissions pick up the promoted model.
- **Prompt template back-test endpoint bypasses `audioProcessingQueue`** — `POST /api/prompt-templates/:id/test` runs up to 10 Bedrock analyses inline via `Promise.all` rather than enqueueing through the shared task queue. Trade-off: does not contend with live upload processing, but admin clicks are unmetered beyond the 10-sample cap. Acceptable because the endpoint is admin-only and the cap is enforced server-side.
- **`BEDROCK_MODEL` is validated at startup and at runtime** — `server/index.ts` emits a `logger.warn` on boot if the env var is set but missing from `BEDROCK_PRICING`. The pipeline's usage-tracking path also calls `warnOnUnknownBedrockModel()` on the first call per unknown model id (deduped via a module-level Set) and logs via `logger.warn`. Trade-off: the warning is non-blocking — cost records still store `$0` for unknown models. Operators who want a hard-fail must add the check themselves.

## Deployment

### EC2 (Primary)
Production runs on an EC2 instance managed with **pm2**, with AWS RDS PostgreSQL for metadata and S3 for audio.

#### SSH Access
```bash
ssh -i /path/to/your-key.pem ec2-user@<ec2-ip-or-hostname>
# Username may be 'ubuntu' depending on AMI
```
To find your key pair name: AWS Console → EC2 → Instances → select instance → "Key pair name".
To find your IP: AWS Console → EC2 → Instances → "Public IPv4 address".
You can also use **EC2 Instance Connect** (no key needed) via the AWS Console "Connect" button.

#### pm2 Commands
```bash
pm2 list                    # Show running processes
pm2 restart all             # Restart the app after config changes
pm2 logs --lines 50         # View recent logs
pm2 logs --err --lines 50   # View error logs only
pm2 stop all                # Stop the app
pm2 start dist/index.js --name callanalyzer  # Start fresh
pm2 save                    # Save process list for auto-restart on reboot
```

#### Updating the App on EC2
```bash
# Quick deploy (recommended):
cd /path/to/assemblyai_tool
./deploy.sh              # Pulls main, installs, builds, restarts pm2

# Or deploy a specific branch:
./deploy.sh feature-branch

# Manual steps (if deploy.sh is not available):
git pull origin main
npm install
npm run build
pm2 restart all
```

#### Updating Environment Variables
```bash
nano .env                   # Edit the file (DO NOT use quotes around values unless needed for #)
unset DATABASE_URL          # Clear any shell overrides (dotenv won't overwrite existing env vars)
pm2 delete callanalyzer     # Delete old process (pm2 restart caches env vars)
pm2 start dist/index.js --name callanalyzer  # Start fresh
pm2 save                    # Save process list for auto-restart on reboot
pm2 logs --lines 20         # Verify startup — look for:
                            #   [AUTH] Using PostgreSQL session store
                            #   NOT: "password authentication failed"
```
**Important**: `dotenv` does NOT override existing shell environment variables. If you `export DATABASE_URL=...` in your shell, that takes precedence over `.env`. Always `unset` first, then `pm2 delete` + `pm2 start` (not `pm2 restart`).

### VPC Endpoints (Recommended)
S3 and Bedrock traffic can be routed through AWS's private network instead of the public internet using VPC endpoints. This improves HIPAA posture by eliminating internet traversal for PHI. The S3 Gateway endpoint is free. No application code changes required. See [`docs/vpc-endpoints.md`](docs/vpc-endpoints.md) for setup instructions.

### GitHub Actions CI/CD

**CI Pipeline** (`.github/workflows/ci.yml`):
Runs on every push to `main` and every PR. Three parallel jobs:
1. **Test & Build** — type check (`tsc`), backend unit tests with c8 coverage (`npm run test:coverage`, gate at 65% statements), frontend unit tests (`npm run test:client`), production build
2. **E2E Tests** — Playwright chromium against the dev server (installed via `npx playwright install chromium --with-deps`); uploads `playwright-report/` artifact on failure
3. **Dependency Audit** — `npm audit` for vulnerabilities; blocks on critical severity

**Deploy Pipeline** (`.github/workflows/deploy.yml`):
Triggers automatically **after CI passes** on `main` (via `workflow_run`). SSHs into EC2 and runs `deploy.sh`. Manual `workflow_dispatch` is available for hotfixes (bypasses CI gate). Required GitHub Secrets: `EC2_SSH_KEY`, `EC2_HOST`, `EC2_USER`, `EC2_APP_DIR`.

**Deploy flow**: CI passes → deploy.yml triggers → SSH to EC2 → `deploy.sh` (pull → install → type check → test → build → pm2 reload → health check). Uses `pm2 reload` for zero-downtime (new process starts before old one dies). Post-deploy health gate: if `/api/health` doesn't respond within 30s, auto-rollback to previous commit. Deploy workflow also runs an independent post-deploy health verification (validates response body, not just HTTP 200). On build/test failure, also auto-rolls back.

Additional workflows:
- `.github/workflows/error-monitor.yml` — Checks pm2 status, HTTP health, error logs, disk space, **database connectivity** (PostgreSQL SELECT 1), and memory usage every 4 hours. Creates GitHub Issues on failure with deduplication (adds comments to existing open alerts within 24 hours instead of creating duplicates).
- `.github/workflows/codeql.yml` — CodeQL SAST (Static Application Security Testing) scanning on push to main, PRs, and weekly. Scans JS/TS for SQL injection, XSS, command injection, path traversal, prototype pollution, regex DoS, hardcoded credentials. Results in GitHub Security tab.
- `.github/workflows/view-logs.yml` — Manual trigger to view pm2 logs without SSH
- `.github/dependabot.yml` — Dependabot: weekly npm security scans (Monday 06:00 ET) auto-create PRs for vulnerable deps. Groups minor/patch updates. Also monitors GitHub Actions versions.

**Rollback**:
- `deploy-rollback.sh` reverts to the pre-deploy commit (auto-saved by `deploy.sh`)
- Also accepts an explicit commit SHA: `./deploy-rollback.sh <commit-sha>`
- Preserves `.env` across checkout to avoid losing credentials
- Includes post-rollback health check (30s poll loop on `/api/health`) — warns if app doesn't respond (F-26)
- Deploy history logged to `.deploy-last.log`

**Blue-Green Deployment** (optional, zero-downtime):
- `deploy-bluegreen.sh` — builds and starts the inactive slot, health-checks, then swaps Caddy upstream
- Two pm2 process slots defined in `ecosystem.config.cjs`: blue (port 5000), green (port 5001)
- Caddy admin API (`localhost:2019`) enables hot upstream swap without restart — see `deploy/ec2/Caddyfile.bluegreen`
- If Caddy admin API isn't available, falls back to pm2 port swap (brief interruption)
- Failed health check → new slot is killed, old slot stays live — zero user impact
- To enable: replace Caddyfile with `Caddyfile.bluegreen`, reload Caddy, use `deploy-bluegreen.sh` instead of `deploy.sh`

#### AWS Credential Rotation on EC2
When IAM keys are rotated (shared across CallAnalyzer, RAG Tool, PMD Questionnaire):
1. Update `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env`
2. `pm2 restart all`
3. Verify with `pm2 logs --lines 20` — confirm S3 and Bedrock initialize without errors
4. **Remember**: Update credentials on ALL services using this IAM user

## Documentation Maintenance

Keep `CLAUDE.md` updated when making structural changes. Specifically, update docs when:

- **New API routes** are added or existing routes change → update the API Routes table
- **Environment variables** are added/removed → update the Environment Variables section
- **Storage backend** logic changes → update Storage Backend Selection
- **New services** are added under `server/services/` → update Architecture section
- **Deployment** process changes (new hosting, new process manager) → update Deployment section
- **Dependencies** are significantly added/removed → update Tech Stack
- **Auth/RBAC** rules change → update Role-Based Access Control
- **AI model** defaults change → update Environment Variables and Common Gotchas

## RAG Knowledge Base Integration (ums-knowledge-reference)

CallAnalyzer integrates with the **ums-knowledge-reference** repository to ground AI analysis in company-specific documentation via RAG (Retrieval-Augmented Generation).

### What It Does
1. **Retrieves relevant context** at analysis time — queries the knowledge base for company policies, required phrases, and procedures relevant to the call category
2. **Injects context into the Bedrock prompt** as a "COMPANY KNOWLEDGE BASE" section — AI evaluates agents against actual company standards instead of generic best practices
3. **Enhances coaching recommendations** with specific references to company training materials (sources reused from analysis, no duplicate API call)
4. **Stores RAG sources** in `analysis.confidenceFactors.ragSources` so reviewers can see which documents influenced the AI's scoring

### Architecture
- **Client**: `server/services/rag-client.ts` — queries the knowledge base API with `X-API-Key` auth
- **Auth**: Service-to-service via `X-API-Key` header (timing-safe comparison on the KB side)
- **Caching**: LFU (Least Frequently Used) cache, 50 entries, 30-min TTL — category-based queries hit the cache ~80% of the time
- **Confidence filtering**: High-confidence results include 4 sources; partial includes 2 + disclaimer; low skipped entirely
- **Prompt injection**: `buildRagQuery()` uses category-specific templates (not raw transcript text) to avoid sending PHI to the knowledge base
- **Graceful fallback**: if RAG service is unavailable or slow (>8s timeout), analysis proceeds without additional context
- **Parallelization**: RAG fetch runs concurrently with injection detection; pipeline awaits RAG completion before AI analysis

### Integration Points
- `server/routes/pipeline.ts:processAudioFile()` — fetches RAG context before AI analysis (both batch and on-demand paths)
- `server/services/ai-provider.ts:buildAnalysisPrompt()` — injects RAG context into prompt
- `server/services/coaching-alerts.ts` — reuses RAG sources from analysis in coaching plans
- `server/services/rag-client.ts:getRagCacheMetrics()` — cache hit/miss stats for admin monitoring
- `server/services/scoring-feedback.ts` — captures manager score overrides as corrections; injects into future prompts so AI learns from mistakes
- `server/services/best-practice-ingest.ts` — auto-ingests exceptional calls (≥9.0) to KB as reference documents
- `server/services/medical-synonyms.ts` — expands medical abbreviations in search (e.g., "O2" → also matches "oxygen")

### Feedback Loop (scoring corrections → improved AI)
When managers edit a call's score, the correction is recorded (reason, original/corrected scores, sub-score changes). Recent corrections for the same call category are injected into future Bedrock prompts as "RECENT SCORING CORRECTIONS". Over time, the AI aligns with human judgment without prompt engineering. Corrections are also persisted to S3 (`corrections/` prefix) for audit trail.

### Best Practice Ingestion
When `BEST_PRACTICE_INGEST_ENABLED=true`, exceptional calls (≥9.0) are auto-sent to the Knowledge Base as text documents in a "best-practices" collection. Future RAG queries then retrieve real examples of excellent call handling alongside company policies.

### Configuration
```
RAG_ENABLED=true
RAG_SERVICE_URL=http://localhost:3001    # Knowledge base API URL
RAG_API_KEY=<64-char-shared-secret>      # Same key as SERVICE_API_KEY on the KB side
BEST_PRACTICE_INGEST_ENABLED=true        # Auto-ingest exceptional calls to KB (optional)
```

## Common Gotchas
- **Chart color strings use `var(--x)` not `hsl(var(--x))`** (design theme installment 1) — theme tokens now hold full OKLCH color values, so wrapping them in `hsl()` produces invalid CSS. All 47 sites in `components/transcripts/audio-waveform.tsx`, `pages/agent-compare.tsx`, `dashboard.tsx`, `insights.tsx`, `performance.tsx`, `reports.tsx`, `sentiment.tsx` were migrated. Alpha modifiers like `hsl(var(--x) / 0.5)` → `color-mix(in oklch, var(--x), transparent 50%)`. Recharts, canvas `fillStyle`, and inline SVG `stroke`/`fill` all accept OKLCH in target browsers (Safari 15.4+, Chrome 111+, Firefox 113+).
- **Theme tokens are OKLCH values, not HSL tuples** (design theme installment 1) — `--background`, `--primary`, `--border` etc. resolve to `oklch(...)` or `var(--paper)` etc. directly. Tailwind colors in `tailwind.config.ts` consume them as `var(--background)` unwrapped. Do NOT write `hsl(var(--ring))` or `hsla(var(--primary), 0.5)` — both produce invalid CSS.
- **Font families changed app-wide** (design theme installment 1) — Inter Tight (display), Inter (UI), IBM Plex Mono (numerics, small-caps mono labels, timestamps, cost strings). JetBrains Mono is GONE. Loaded via `client/index.html` Google Fonts link. Tailwind exposes `font-display`, `font-sans`, `font-mono` utility classes.
- **Design system installments landed so far** — (1) Simulated Call Generator at `client/src/pages/simulated-calls.tsx` (installment 1, warm-paper theme + first page re-skin), (2) role-routed Analytics Dashboard at `client/src/components/dashboard/{ledger-variant,pulse-variant}.tsx` + shared primitives at `components/dashboard/primitives.tsx` (installment 2), (3) Agent Lens at `client/src/pages/my-performance.tsx` (installment 3 — hero greeting + BigStat grid + exemplar moment + daily WeekStrip + document-row recent-calls/coaching/corrections), (4) Call Transcript Viewer at `client/src/components/transcripts/{viewer-header,scrubber,side-rail}.tsx` + a heavy trim of `transcript-viewer.tsx` (installment 4 — app bar with breadcrumbs+search+role toggle+export, call header with meta grid, document-row transcript with per-utterance sentiment dots, bottom-docked Scrubber with waveform+sentiment ribbon, side rail with score dial + rubric + coaching highlights + commitments + topics), (5) Coaching role-routed at `client/src/pages/{coaching,my-coaching}.tsx` with `client/src/components/coaching/{page-shell,primitives,agent-inbox,manager-board,detail-panel,assign-modal}.tsx` (installment 5 — shared app bar with My/Team toggle, Agent Inbox variant with hero + next-action card + GrowthRing-decorated InboxRows + right rail, Manager Board variant with 5-column Kanban across a derived lifecycle, slide-in DetailPanel with StageTrack + Evidence section, centered AssignModal with transcript-viewer prefill. Skill Tree variant intentionally dropped; 7 deferred backend items tracked in `docs/coaching-backend-followons.md`), (6) Calls list + Search + Auth + Upload sweep at `client/src/pages/{transcripts,search,auth,upload}.tsx` + `client/src/components/tables/{calls-list-header,calls-preview-rail}.tsx` + heavy restyle of `calls-table.tsx` + `components/upload/file-upload.tsx` (installment 6 — page-level app bar + summary ticker + saved-views pills + warm-paper table tokens + 380px right-docked preview rail with tier-colored score + sentiment dot + flag pills + AI summary + Open-transcript + Coach CTAs; Search consolidated onto the same table visuals and `components/search/{call-card,employee-filter}.tsx` deleted; Auth gradient logo tile replaced with a copper dot + Waveform glyph; Upload info grid dropped), (7) Reports at `client/src/pages/reports.tsx` + heavy restyle of `client/src/components/reports/report-components.tsx` (installment 7 — warm-paper app bar with dynamic display-font page title, mono-uppercase filter-row labels, `SectionHeader`/`FilterLabel`/`ErrorBanner`/`scoreTierColor` helpers, `CHART_TICK`/`CHART_TOOLTIP`/`CHART_LEGEND` Recharts constants for copper line + sage/muted/destructive stacked bars + mono axis ticks, MetricCard with display-font 36px numbers + sage/destructive deltas, SubScoreCard with flat tier-colored progress bar, FlaggedCallCard with 3px left stripe + color-mix play button, hairline-separated top-performers + sentiment-breakdown rows, agent profile 4-stat grid + sage/copper strength/suggestion lists + secondary AI-summary panel), (8) Admin + Employees + Settings sweep at `client/src/pages/{admin,employees,settings}.tsx` (installment 8 — admin.tsx gets a warm-paper app bar + display-font dynamic page title + `AdminTab` tab bar with an amber-circle pending-request badge, plus full warm-paper rewrites of the Access Requests body (hairline-separated pending list + archive history), Users body (inline create panel + hairline user list + accent-bordered inline edit/reset-password panels), Role Definitions body (two-column meta + capability grid with sage ✓ / muted strikethrough ✕), Pipeline Settings body (display-font current-value + mono unit + source pill + Reset link via new `PipelineField` helper), and AI Models body (per-tier `ModelTierRow` with default/env/override metadata grid + em-dash-bullet Tips panel). New shared admin primitives `AdminSectionHeader` / `AdminFieldLabel` / `AdminStatusPill` / `AdminRolePill` / `AdminListRow` / `AdminPanel` / `AdminSourcePill` / `AccessRequestsErrorState` replace the shadcn `Card` / `Badge` / `Label` vocabulary. employees.tsx: app bar + "Directory" kicker + tabular-nums summary pill, `ActionChip` sub-team toggle, hairline-bordered department groups with display-font headers + caret toggle + active/total counts, paper-2 sub-team banners, document-row employee rows with copper `AvatarInitials` + optional pseudonym secondary line + mono extension + `StatusPill` + ghost action buttons; selected-for-compare rows get a copper left-stripe + soft bg; Compare panel is an accent-bordered shell with two paper-2 `CompareCard`s (display-font stat numbers, mono sentiment triple). settings.tsx: app bar + "Appearance" kicker, new `SettingsPanel` shell, warm-paper mono-uppercase `ToggleGroup`, copper-ring `SelectionTile` for Background + Glass picks. The decorative `BgPreview` + `GlassPreview` SVGs are INTENTIONALLY left in their original non-warm-paper styles because they are samples of alternative aesthetics the user can pick from — do not migrate their palettes. (9) Sentiment at `client/src/pages/sentiment.tsx` + new shared chart-primitives module at `client/src/components/analytics/chart-primitives.ts` (installment 9 — chart primitives extraction + first analytics-page pilot; warm-paper app bar with breadcrumb, "Analytics" mono kicker + display-font "Sentiment" title, three-tile summary strip with sage/muted/destructive icon-bg + display-font count + mono pct, donut-distribution + 90-day stacked-area trend both wired through the new `CHART_TICK`/`CHART_TOOLTIP`/`CHART_LEGEND`/`SENTIMENT_COLOR` exports, hairline-separated agent breakdown rows with paper-2 segmented bar). (10) Agent Scorecard at `client/src/pages/agent-scorecard.tsx` (installment 10 — warm-paper app bar with Dashboard › Employees › Scorecard breadcrumb + back/print buttons; printable body with copper-avatar agent hero + display-font overall score tinted via `scoreTierColor()`; 4-tile key metrics strip; copper-soft gamification pills + `Fire` streak glyph; hairline-segmented sentiment bar; sage / copper left-stripe side-by-side Strengths / Suggestions panels with new `InsightRow` glyph+text+count-pill; copper-soft common-topics tag cloud; HealthPulseCard rewritten with sage/amber/destructive severity stripe + new `WindowStat` helper + mono tabular-nums sub-score deltas; 12-bar score-trend mini chart per-bar-tinted via `scoreTierColor()`; `FlaggedCallsPanel` for exceptional + flagged calls). New panel-scoped helpers `ScorecardPanel` / `MetricTile` / `SentimentStat` / `InsightRow` / `FlaggedCallsPanel` / `WindowStat` — INLINE to agent-scorecard.tsx by design; promote to a shared primitive once a second consumer (Performance or Insights) repeats the repetition. Dropped imports: shadcn `Badge`, `SCORE_EXCELLENT/GOOD/NEEDS_WORK` (superseded by `scoreTierColor()` from chart-primitives). (11) Performance + Insights at `client/src/pages/{performance,insights}.tsx` (installment 11 — company-wide analytics duo, manager+ only). performance.tsx: warm-paper app bar + page header with 'Agents' / 'Overall avg' stat tiles (avg tinted via `scoreTierColor()`); dedicated filter row with department `Select` + right-aligned 'Total calls' stat; top-10 horizontal bar chart wired through `CHART_TICK`/`CHART_TOOLTIP`/`CHART_GRID_STROKE` with bars tinted per `scoreTierColor()`; hairline-separated table with copper avatar initials, display-font score + mono /10 suffix, mono-uppercase sortable header cells via new `PerfTableHeader` + `PerfTableHeaderSort` helpers, paper-2 score progress bar tinted per tier. insights.tsx: warm-paper shell with right-aligned 'Analyzed / N calls' stat in the header; three `SummaryTile`s with tone left-stripe (score / destructive / amber) + mono kicker + display-font value + mono suffix + footnote; stacked-area 90-day sentiment trend using `SENTIMENT_COLOR`; two-column complaint-topics (destructive stripe, hairline rows + tabular-nums counts + destructive fill bar) and most-common-topics (copper BarChart with descending opacity); amber-stripe escalations panel (edge-to-edge document rows with `scoreTierColor()` score + truncated summary + mono date); low-confidence-calls panel (mono % paper-2 pill). All queries + links preserved. New panel-scoped helpers `PerfPanel` / `PerfTableHeader` / `PerfTableHeaderSort` / `HeaderStat` (performance) and `PageShell` / `Panel` / `SummaryTile` / `ErrorBanner` / `EmptyRow` (insights) — inline to each page; promote when a 4th analytics page repeats. Dropped imports: shadcn `Card*` / `Badge`, `SCORE_EXCELLENT/GOOD/NEEDS_WORK` (scoreTierColor handles tiering). (12) Team Analytics + Agent Compare at `client/src/pages/{team-analytics,agent-compare}.tsx` (installment 12 — cross-agent comparison duo, manager+ only). team-analytics.tsx: warm-paper app bar (Dashboard > Team analytics) + Export CSV button; page header with 'Teams' / 'Total calls' stat tiles; dedicated From/To filter row; cross-team bar chart with rotated labels + bars tinted per `scoreTierColor(avgScore / 10)` (backend returns 0-100 scale); single document-card shell with caret-expand rows (tier-colored dot, display-font team name, mono employee count, right-aligned Calls/Avg-score/Avg-duration stats); expanded state renders paper-2 banner + hairline member table. agent-compare.tsx: app bar (Dashboard > Employees > Compare); selection panel with warm-paper chips using 3px left-stripe in per-agent accent + X remove; per-agent palette is 5 distinct OKLCH hues within the warm-paper system (`var(--accent)`/`var(--sage)`/`var(--amber)`/`var(--destructive)`/plum) replacing the old hex COLORS array; 5-col summary tile grid with top-stripe + CompareStatLine rows; radar chart (sub-scores) and stacked bar chart (sentiment) both wired through `CHART_TICK`/`CHART_LEGEND`/`CHART_GRID_STROKE`/`SENTIMENT_COLOR`; detailed metrics table (8 rows) highlights the best column in sage + `CheckCircle` glyph. New panel-scoped helpers `TeamPanel` / `ScoreBar` / `TeamMemberHeader` / `TeamHeaderStat` / `HeaderStat` / `ErrorBanner` (team-analytics) and `ComparePanel` / `CompareStatLine` / `CompareTableHeader` / `ErrorBanner` (agent-compare). (13) Engagement surface at `client/src/pages/{leaderboard,heatmap-calendar,call-clusters}.tsx` (installment 13 — three viz-heavy standalone pages). leaderboard.tsx: warm-paper app bar + Trophy kicker + PeriodTab mono-uppercase tabs (Week/Month/All time); top-3 podium with #1 highlighted via `var(--copper-soft)` bg + `var(--accent)` border + row-span-2 treatment; `RankGlyph` uses `Crown` (amber) / `Medal` (muted) / `Medal` (accent) for ranks 1/2/3 and mono `#N` for rest; full-rankings table uses hairline-separated grid rows with display-font Points column, `scoreTierColor()` for Avg, `StreakChip` with `Fire` + mono count; badges render as copper-soft circles on podium and muted outline icons in the table. heatmap-calendar.tsx: app bar + page header + 3-`FilterBlock` filter row (Window / Agent / Metric); 4 summary `StatTile`s including Avg score tinted via `scoreTierColor()`; grid cells use warm-paper palette — volume mode uses `color-mix(in oklch, var(--accent), var(--paper) N%)` opacity buckets, score mode delegates to `scoreTierColor()`; legend swatches switch by mode. call-clusters.tsx: app bar with right-aligned `Rising trends` destructive pill when any; filter row + cluster grid; cluster cards get a destructive left-stripe when `trend === "rising"` so issues surface visually; warm-paper topic chips (paper-2 + hairline); paper-2 banner for 2×2 stats grid (Calls / Avg score / Recent 7d / Pos-neg %); sentiment bar uses `SENTIMENT_COLOR`; trend glyphs: `TrendUp` destructive (rising = bad), `Minus` muted (stable), `TrendDown` sage (declining = good). Dropped imports across all three: shadcn `Card*` / `Badge` / `Tabs`, `SCORE_EXCELLENT/GOOD/NEEDS_WORK` (superseded by `scoreTierColor()`). (14) Admin ops surface at `client/src/pages/{security,system-health,batch-status}.tsx` (installment 14 — three admin-only operational dashboards). security.tsx: app bar + page header + 4-tile summary strip (Unacknowledged / Critical / Active breaches / MFA enabled) with tone left-stripe by severity; `SecurityTab` badge-counter row; alerts tab uses severity-tone stripes per row with `SeverityPill` + mono timestamp + k:v detail grid (critical/high mapped to destructive, medium to amber); breaches tab has an inline accent-bordered 'Report new breach' form + breach rows with notification-status pills (pending=destructive, notified=accent, resolved=sage) + copper-stripe timeline; MFA tab is a hairline-separated username table with sage `CheckCircle` 'Active' pill. system-health.tsx: app bar + header with right-aligned large `StatusPill`; amber-stripe Active-issues banner; 6-card subsystem grid via new `SubsystemCard` primitive + `MetricRow` children (tabular-nums values, sage/destructive tint on alert/success); `StatusPill` maps healthy/degraded/unhealthy to sage `CheckCircle` / amber `Warning` / destructive `XCircle` soft-bg combos; scoring-quality alerts render as inset warm-red-soft or amber-soft inline callouts. batch-status.tsx: app bar with spinning Refresh button; disabled-state amber-stripe banner; `ModeTile` with accent/sage left-stripe (batch=deferred, immediate=on-demand) + display-font 24px mode name; two `StatTile`s (Pending / Active); active-jobs table with `JobStatusPill` (sage completed, destructive failed/stopped/expired, accent inprogress/submitted); em-dash-bullet Notes panel. Dropped imports across all three: shadcn `Card*` / `Badge` / `Tabs`, hardcoded bg-green/bg-red/bg-amber/dark:bg-* classes (replaced with on-system tones). (15) Admin tooling at `client/src/pages/{spend-tracking,prompt-templates,ab-testing}.tsx` (installment 15 — final batch, completes the design sweep). spend-tracking.tsx: app bar + page header + `PeriodTab` row (Current month / Last month / YTD / All time); per-period 4-`SummaryTile` strip (cost with sage stripe / volume / per-call avg / window); daily spend area chart with copper-tinted gradient via `CHART_TICK`/`CHART_TOOLTIP`/`CHART_GRID_STROKE`; service-split donut (sage AssemblyAI + accent Bedrock); cost-by-user horizontal bar chart in copper; `ActivityRow` document rows with copper Phone (call) / sage Flask (A/B test) circle + mono breakdown + paper-2 cost pill. prompt-templates.tsx: app bar + info-banner with em-dash bullets; `TemplateCard` rewrite uses `PromptStatusPill` (sage Active / accent required / neutral inactive/recommended) + `PromptSection` helper + paper-2 weight tiles with display-font 20px tabular-nums; `TemplateForm` accent-bordered shell with mono `PromptFieldLabel` and a total-weight indicator that flips sage at 100% / destructive otherwise; back-test results Dialog uses `BackTestStat` tiles + `DeltaPill` (sage/amber/neutral). ab-testing.tsx: app bar + page header + `ABTab` badge row; New-test tab uses two `ABPanel`s (Upload drop-zone switches to copper-soft when a file is loaded + amber-stripe cost-note banner); Past-tests tab uses `ABTestRow` with copper accent border + soft bg when selected + status glyphs (SpinnerGap accent / CheckCircle sage / WarningCircle destructive); Aggregate panel renders `AggregateRowCard`s with tone left-stripe per recommendation (promote_test=sage, insufficient_data=amber, others=neutral) + three `ABStat` tiles + latency line with sage/amber delta; active-model banner uses copper-stripe panel with paper-card model-ID pill; promote flow has a confirm step with mono-uppercase prompt + Confirm/Cancel. Dropped imports across all three: shadcn `Card*` / `Badge` / `Tabs` / `Label` / `Progress`, hardcoded bg-green/bg-red/bg-amber/dark:bg-* classes. **Status: all 15 installments + closing sweep now landed.** Zero remaining shadcn `Card*` / `Tabs` legacy in page bodies (Badge kept only in shared dialogs like `dialog.tsx` as a shadcn primitive). Closing sweep (after installment 15) also: (a) rewrote `client/src/pages/not-found.tsx` — warm-paper 404 with copper-soft warning glyph + mono kicker + display-font title; (b) removed dead Card/Badge imports from `reports.tsx` / `my-coaching.tsx` / `my-performance.tsx` (the last two had 2 Card blocks each for loading/empty states, migrated inline); (c) **deleted** `client/src/components/dashboard/{metrics-overview,sentiment-analysis}.tsx` as dead code (superseded by the role-routed ledger/pulse variants in installment 2, never imported from anywhere in client/src); removed the unused `getSentimentColor` function from `transcripts/transcript-viewer.tsx`; (d) **deleted** the legacy utility blocks from `client/src/index.css` — `.sentiment-positive/.neutral/.negative`, `.metric-card` + hover + dark variants, `.chart-container`, `.gradient-border` + inner — replaced with a single explanatory comment block pointing to the successor tokens (`SENTIMENT_COLOR` / inline warm-paper panels / chart-primitives); (e) migrated `components/layout/sidebar.tsx` (4 sites: notification severity glyphs → sage/destructive/amber; flagged + pending count badges → mono tabular-nums with warm-paper soft-bg pills; WebSocket connection dot → sage/amber/destructive); (f) migrated `components/mfa-setup-dialog.tsx` (status dot, disclaimer banners, recovery-codes-low banner, disable-MFA destructive button, copied-indicator checkmarks — all hardcoded bg-yellow/green/red classes dropped). Known follow-up: `client/src/pages/simulated-calls.tsx` (installment 1, the first page redesigned) still carries ~27 shadcn `Card`/`Tabs` usages from its pre-primitives era; a full re-redesign would require a fresh Claude Design handoff. Dark-mode QA (after closing sweep): comprehensive token sweep replaced pre-warm-paper Tailwind color classes (`bg-(green|red|amber|blue|purple|emerald|orange|yellow)-[0-9]` + `text-*` variants) with warm-paper CSS tokens across `ab-test-components.tsx`, `weekly-changes.tsx` (full migration + Badge import drop), `calls-table.tsx` (flag icons + delete button), `error-boundary.tsx` (full fallback UI), `transcript-viewer.tsx` (6 sites: Manual Edits banner, AI Analysis Skipped banner, Call Flags with inline pill palette, AI Confidence block, search highlight `<mark>`, "Why this score?" flag pills via `pillTone` record), `file-upload.tsx` (3 sites), `pages/transcripts.tsx` (Warning glyph), `pages/auth.tsx` (role-icon color via inline style). Also deleted dead `components/dashboard/performance-card.tsx` (superseded by role-routed ledger/pulse variants). `ROLE_CONFIG` in `lib/constants.ts` dropped its unused `badgeClass` field; `color` now uses warm-paper tokens (`viewer=muted-foreground`, `manager=amber`, `admin=accent`). Tests pass; `constants.test.ts` updated to assert `var(...)` token format. Net result: zero hardcoded Tailwind color utility classes across `client/src/` outside the documented exceptions (`simulated-calls.tsx`, `settings.tsx` BgPreview/GlassPreview SVGs, `components/ui/*` shadcn primitives).
- **Recharts styling lives in `components/analytics/chart-primitives.ts`** (installment 9) — `CHART_TICK`, `CHART_TOOLTIP`, `CHART_LEGEND`, `CHART_GRID_STROKE`, `SENTIMENT_COLOR`, and `scoreTierColor()` are exported from the shared module. `pages/reports.tsx`, `pages/sentiment.tsx`, `pages/agent-scorecard.tsx` (installment 10), `pages/{performance,insights}.tsx` (installment 11), `pages/{team-analytics,agent-compare}.tsx` (installment 12), `pages/{leaderboard,heatmap-calendar,call-clusters}.tsx` (installment 13), and `pages/spend-tracking.tsx` (installment 15) consume them; any future analytics page MUST import from this module rather than re-define inline — the previous "lifted from reports.tsx bottom" pattern is gone. Canonical fill mappings: `SENTIMENT_COLOR.positive`/`neutral`/`negative` → sage / muted-foreground / destructive; `var(--accent)` for primary lines; `scoreTierColor(score)` for score tiers (≥8 sage, ≥6 foreground, ≥4 accent/copper, below destructive, null/undefined muted). Pure function + constants — no React imports — and covered by `chart-primitives.test.ts` (11 cases) so palette / breakpoint drift breaks the test suite.
- **`CallsTable` preview-rail opt-in** — `client/src/components/tables/calls-table.tsx` accepts optional `onRowSelect?: (id) => void` + `selectedCallId?: string | null` props. When `onRowSelect` is passed, rows become clickable (cursor pointer) and clicking a row's content area fires the callback — used by `transcripts.tsx` CallsListMode to drive the 380px `CallsPreviewRail`. Action cells (checkbox td, agent td with the assign-select, actions td with Eye/Play/Download/Delete) call `e.stopPropagation()` inside their td `onClick` so per-row interactions don't accidentally fire a preview select. Adding a new interactive control to any row MUST stop propagation the same way, or the click will leak to the row-level select and change the preview. Backwards compatible: CallsTable's other consumers (Search results table uses its own inline implementation) don't pass these props so rows stay inert there.
- **Deleting a legacy `index.css` utility only after confirming zero consumers** — the "Legacy utilities" list in the installment bullet above enumerates pre-warm-paper CSS classes that stick around until their last consumer is migrated. Before removing one (e.g. `.drop-zone-active` was deleted in installment 6), grep the entire `client/src/` tree (including tests) for literal class references AND for string-interpolation sites (`className={isActive && "drop-zone-active"}` style). Replace the deleted block in `index.css` with a one-line comment pointing to the component that now owns the styling inline, so a future grep for the name still lands on an explanation rather than a void.
- **Coaching UI derives design concepts the schema doesn't have** — the warm-paper Coaching variants render a 5-stage lifecycle, 5 source types, and warm "growth copy" per session that none exist as schema fields. `client/src/components/coaching/primitives.tsx` synthesizes them: `deriveStage()` maps `status + actionPlan` completion to `open/plan/practice/evidence/signed-off`, `deriveSource()` reads `assignedBy` ("starts with 'System'" → ai; else manager), `growthCopyForCategory()` returns a canned sentence per category. All three are correctness-adjacent approximations, not truths — a manager who marks some action items done without flipping `status` to `in_progress` will see the session bucket one stage off. Pure-function coverage in `primitives.test.ts` (21 cases). Replacement paths for all three are enumerated in `docs/coaching-backend-followons.md` (F-C1 stage column, F-C5 source field, F-C4 growth_copy/suggested_fix columns).
- **Coaching has two page-level URLs, one shell** — `/coaching` renders the Manager Board for manager+admin; `/my-coaching` renders the Agent Inbox for everyone authenticated (sidebar nav gates `/coaching` to `requireRole: ["manager", "admin"]`). Both wrap their bodies in `CoachingPageShell` (`components/coaching/page-shell.tsx`) which renders a unified app bar with a role toggle that navigates between the two URLs. The toggle is visible only for manager+admin — viewers don't see it and never leave `/my-coaching`. A single role-routed `/coaching` (dashboard-pattern) was considered but avoided because the two bodies share no data query (`GET /api/my-performance` vs `GET /api/coaching`) and the URL split keeps nav muscle memory working. Both `coaching.tsx` and `my-coaching.tsx` own their own `openedSessionId` state + pass it into `<DetailPanel>`; the panel component is shared between variants with a `canManage` prop gating the outcome fetch + status-transition buttons.
- **`components/dashboard/primitives.tsx` is reused outside the dashboard** — Avatar, StatBlock, ScoreDial, RubricRack, RubricValues are imported by `my-performance.tsx` (Agent Lens) and by `components/transcripts/{viewer-header,side-rail}.tsx` (Transcript Viewer). The in-file docstring still says "Shared visual primitives for the role-routed analytics dashboard" — accurate as far as origin, but treat the module as the shared visual-primitives library for the warm-paper installments, not just the dashboard variants. If you extend the primitives, keep them presentational and data-agnostic.
- **Transcript Viewer event bus** — `ViewerHeader` (app bar), `TranscriptViewer` (body), and `SideRail` are sibling components that don't share state via props. They coordinate via four `window` CustomEvents: `transcript:search-query` {query} (header input → viewer search state; 120ms debounce in the header), `transcript:export` (header button → viewer's `handleExportTranscript` via ref — ref indirection avoids stale-closure capture of `call`/`transcriptSegments` in the empty-deps listener effect), `transcript:download` (header button → viewer's `handleDownloadAudio`, same ref pattern), and `transcript:role-change` {role: "agent"|"manager"} (header toggle → side rail's coaching panel label swap). The ref bridge is load-bearing — moving the listener `useEffect` to depend on `call` or `transcriptSegments` would re-add the listener on every render and multiply event handling. New controls added to the header should follow the same pattern, not introduce prop-drilling through a page-level container.
- **Ctrl/Cmd+F in the Transcript Viewer focuses `#transcript-header-search`** — the old `setSearchOpen(true)` popup was removed in Transcript Viewer installment 4; the keyboard shortcut now `document.getElementById("transcript-header-search").focus()` + `.select()`. If the id ever changes on the ViewerHeader input, the shortcut silently breaks (no error, just no focus). Any future refactor of ViewerHeader must preserve the id.
- **`analyzeCallTranscript` now throws `BedrockClientError` on 4xx-except-429** (F1) — parity with `generateText`. A bad prompt template or invalid model id no longer counts toward the circuit breaker open threshold (INV-32). Pipeline `pipeline.ts:453` Haiku-fallback branch now correctly fires for analyze 4xx errors (previously never did because analyze always threw plain Error).
- **Batch-scheduler `processBatchResults` gates `autoAssignEmployee` on `existingCall.synthetic`** (F2) — INV-35 defense-in-depth. Synthetic calls don't normally reach batch mode (`processingMode:"immediate"`), but the guard closes the latent leak vector.
- **Transcribing-state orphan reaper exists** (F3) — calls stuck in `status:"transcribing"` for >30 min are reaped automatically. 15-min scan interval, 2-min boot delay. Don't manually clear "transcribing" rows — wait for the reaper or check pm2 logs for `transcribing-reaper: reaped stuck transcriptions`. Symmetric with batch orphan recovery but runs regardless of batch mode.
- **Batch-mode pending S3 item is deleted on fall-through** (F6) — when the batch deferral path throws after the pending item was uploaded, `pipeline.ts` deletes `batch-inference/pending/${callId}.json` to prevent a billable AWS Bedrock submission for a call that on-demand will re-process.
- **Boot warning when AUTH_USERS rejects all entries** (F8) — `auth: AUTH_USERS was set but ALL entries were rejected` at `error` level. If you see this with no `DATABASE_URL` fallback, no one can log in. Non-blocking (no process.exit) so the deploy still comes up; relies on operators watching pm2 logs.
- **8x8 telephony scheduler is double-gated** (A1) — `is8x8Enabled()` requires both `TELEPHONY_8X8_ENABLED=true` AND `TELEPHONY_8X8_STUB_ACKNOWLEDGED=true`. Scheduler refuses to start without the ack flag and logs a warning. Operators flipping the legacy enable flag alone will see the integration silently no-op.
- **Webhook delivery sends dual-emit HMAC headers** (A3) — every delivery includes legacy `X-Webhook-Signature` (HMAC over body) AND new `X-Webhook-Timestamp` + `X-Webhook-Signature-V2` (HMAC over `${timestamp}.${body}`). Receivers can verify either; v2 enables replay protection. v1 deprecation timeline TBD — do not remove v1 emission without external coordination.
- **Webhook config writes throw, reads no-op** (A5) — `createWebhookConfig`/`updateWebhookConfig`/`deleteWebhookConfig` throw via `requireS3Client()` if S3 isn't initialized. `getAllWebhookConfigs`/`triggerWebhook` still degrade silently to preserve fire-and-forget semantics. Webhook config list is cached for 30s — disable/delete propagation has up to a 30s tail; account for this during incident response.
- **`rag-client.ts` boot-fails in production on plaintext http://** (A6) — module load throws if `RAG_SERVICE_URL` starts with `http://` and `NODE_ENV=production`. `isRagEnabled()` also returns false as defense-in-depth. Dev/staging warns instead of failing.
- **`s3.ts` ensureCredentials retries IMDS on every call until success** (A2) — previously, a single transient IMDS failure at boot permanently flipped the client into refresh-only mode with no cached credentials. Now `initialized=true` is set only after a successful first fetch. Tradeoff: under sustained IMDS outage, every S3 op pays a 2s IMDS timeout instead of failing once.
- **`s3.ts` listObjects/listObjectsWithMetadata XML-decode keys** (A12) — S3 ListObjectsV2 XML-encodes the 5 predefined entities (`&`, `<`, `>`, `'`, `"`) in object keys. Without decoding, a key like `audio/foo&bar.wav` came back as `audio/foo&amp;bar.wav` and subsequent GET/DELETE silently 404'd. Decoded via `decodeXmlEntities()`.
- **`findCallByExternalId(externalId)` is the upstream-source dedupe primitive** (A10) — added on IStorage and all 3 backends. Backed by a unique partial index on `calls.external_id` (PostgresStorage). Used by telephony-8x8 to skip duplicate recordings before downloading audio. Concurrent ingest workers racing on the same recording id will currently surface as `status: "error"` (pg 23505) instead of `"duplicate"` — telephony catch block does not yet remap.
- **`aws-credentials.ts` log scrapers** (A7-batch2) — `[AWS]` literal stdout prefix is gone. IMDS first-failure logs at `info`, refresh failures escalate to `warn`. Output is structured JSON via `logger.*`.
- **Incident routes 500 on missing `incidents` table** (A7) — `persistIncident` and `createBreachReport` now throw on DB write failure (DB-first persist; in-memory cache only updated after successful persist). On a fresh deploy without `initializeDatabase()` having run, `/api/admin/incidents/*` will 500 instead of silently caching in memory. Run schema migration before exercising admin incident routes.
- **Incident/breach/alert IDs are opaque UUIDs** (A7) — `INC-<uuid>`, `breach-<uuid>`, `alert-<uuid>`. Old `Date.now()`-based IDs were parseable but collision-prone within the same millisecond. Anything that tried to extract a timestamp from an ID needs to read `declaredAt`/`reportedAt` instead.
- **All bracket-prefix log scrapers are now broken except `[HIPAA_AUDIT]`** (A11, #4) — `[AUTH]`, `[SECURITY]`, `[INCIDENT]`, `[BATCH]`, `[CALIBRATION]`, `[JOB_QUEUE]`, `[WEBHOOK]`, `[Webhooks]`, `[OTEL]`, `[AWS]` prefixes and all others are gone. External scrapers grepping for any of these literal strings will silently match nothing — they need to migrate to structured JSON field matching. The `[HIPAA_AUDIT]` stdout line is intentionally preserved as the canonical HMAC chain record.
- **`/api/admin/waf/block-ip` enforces a 30-day max `durationMs`** (A9) — Zod schema rejects values >30 days with a 400. Permanent blocks should omit `durationMs` entirely. Operator scripts that hardcoded multi-month "temporary" blocks must switch to permanent or chunk the duration.
- **Vuln-scanner history retains hollow entries past `MAX_SCAN_HISTORY`** (A12) — older scan reports stay in `scanHistory` with `findings: []` while their summary remains. Frontend code iterating history must expect `findings.length === 0` on archived scans (summary counts are still valid). Previously the entries were `shift()`-ed out entirely; the comment claimed "summary is retained" but it wasn't.
- **`requireMFASetup` is gated on `REQUIRE_MFA=true`** — the middleware is a no-op when the env var is unset. When `REQUIRE_MFA=true`, it enforces MFA enrollment for admin/manager roles on `/api/admin/*` (via `router.use`) and on all manager/admin-gated mutations (per-route). `isMFARoleRequired()` returns true for admin/manager unconditionally, but `requireMFASetup` only consults it after confirming `isMFARequired()` (the env var check). Enrollment endpoints `/api/auth/mfa/setup` and `/api/auth/mfa/enable` are unaffected. **Operational footgun:** flipping `REQUIRE_MFA=true` without enrolling admins first will lock them out of all write operations on their next request — including their own self-service password change at `/api/users/me/password`. Recovery path: enroll via `/api/auth/mfa/setup` and `/api/auth/mfa/enable` first, then change password.
- **`deserializeUser` validates ID format before DB lookup** — ENV-var users have non-UUID IDs (`randomBytes(8).toString("hex")` = 16 hex chars). `deserializeUser` checks UUID regex before querying PostgreSQL; non-UUID IDs skip the DB and go directly to the env-var user fallback. For UUID IDs, transient DB errors still propagate as 500 (A10 contract preserved). Previously, non-UUID IDs from stale sessions caused PostgreSQL `invalid input syntax for type uuid` errors on every request.
- **`AUDIT_HMAC_SECRET` is required in production** (A4) — production boot-fails if unset. The audit chain previously fell back to `SESSION_SECRET`, which silently broke chain verification on session-secret rotation. Add `AUDIT_HMAC_SECRET` to the EC2 `.env` file before next deploy.
- **`LocalStrategy` uses `passReqToCallback`** (A2) — verify callback signature is `(req, username, password, done)`. Client IP is extracted from `req.ip || req.socket.remoteAddress` and passed to `recordFailedAttempt(username, ip)` → `security-monitor.recordFailedLogin`. Brute-force / credential-stuffing alerts depend on this IP and were never firing before A2.
- **`audit_log_integrity` is a singleton row** (A6) — `id=1` is the only legal row, seeded with `'genesis'` on first boot. `loadAuditIntegrityChain()` runs in `server/index.ts` startup right after `initializeDatabase()` and restores the chain head. **F01: now retries 3x with exponential backoff (1s, 2s, 4s) and throws if all retries fail** — the server refuses to start with a forked integrity chain (HIPAA §164.312(b)). Operators must ensure DB connectivity at startup. `persistPreviousHash` is fire-and-forget per `logPhiAccess` call — the in-memory head can drift ahead of the persisted head during a crash mid-burst, in which case the chain breaks at the gap (stdout retains the canonical record).
- **processAudioFile signature is `(callId, audio, options)`** (A22) — not the old 9-positional shape. `audio` is a Buffer; the options object carries originalName, mimeType, callCategory?, uploadedBy?, processingMode?, language?, filePath?. Telephony scheduler and job worker both use this shape.
- **Job queue attempts increment only on failJob** (A18) — a worker crash no longer burns an attempt by itself. Stale-heartbeat reap calls failJob explicitly, so a job with a flapping DB connection can still burn the retry budget through repeated reaps. Heartbeat every 30s; stale threshold 2min.
- **Upgrading an existing DB to the A18 schema leaves orphan 'running' jobs unreapable** — `last_heartbeat_at` is NULL and the reaper's `<` comparison skips NULLs. On first deploy, run `UPDATE jobs SET last_heartbeat_at = NOW() WHERE status = 'running' AND last_heartbeat_at IS NULL;` before expecting reap to work on stale jobs.
- **estimateBedrockCost returns `number | null`** (A27) — unknown models return null. Unknown-model usage records store `estimatedCost: 0`, not a Sonnet ballpark. Adding a new BEDROCK_MODEL requires updating `BEDROCK_PRICING` in `server/routes/utils.ts`. No longer silent: `server/index.ts` startup warns at boot if `BEDROCK_MODEL` is set but absent from the pricing table, and `warnOnUnknownBedrockModel()` in `routes/utils.ts` fires a once-per-model `logger.warn` from the pipeline cost-tracking path.
- **`/api/calls` offset mode is gone** (A20) — `?page=2` silently returns page 1. Frontend must send `?cursor=<token>`; consume `nextCursor` from the response.
- **`/api/employees` paginates by default** (A20) — default limit=50, max=500. Response is a bare `Employee[]`; total in `X-Total-Count` header, `X-Pagination-Default: true` if the client omitted `?limit`. Any code iterating the response assuming "all employees" will silently truncate.
- **CSV import is multipart upload** (A29) — POST /api/employees/import-csv expects `multipart/form-data` with a `file` field. The old "read `./employees.csv` from server cwd" behavior is gone.
- **`uploadsDir` is `path.resolve(cwd, "uploads")`** (A42) — absolute. pm2 working-directory changes no longer strand uploads.
- **Graceful shutdown drains JobQueue before DB pool close** — `gracefulShutdown()` in `server/index.ts` calls `jobQueue.stop()` between the batch-scheduler stop and the audit log flush, wrapped in a 15s `Promise.race` hard cap inside the 30s hard-exit budget. In-flight audio pipeline jobs drain gracefully instead of crashing when the pool closes under them. Previously a known gap (A34). `jobQueue` is accessed via `getJobQueue()` exported from `server/routes.ts`.
- **PATCH /api/calls/:id/analysis** is strict-whitelisted via `analysisEditSchema.strict()`. Adding a new editable field requires editing `shared/schema.ts`; passing unknown keys is rejected with 400.
- **audioProcessingQueue** is a single shared singleton exported from `server/routes/pipeline.ts`. A/B test uploads, bulk re-analysis, and normal call uploads compete for the same concurrency slots. Don't construct `new TaskQueue()` in a route file — import the singleton.
- **Global JSON body limit is 1MB** (`express.json({limit:"1mb"})` in `server/index.ts`). Routes that legitimately need larger payloads must mount a per-route `express.json({limit:...})` override before the route handler.
- **WAF is two middlewares**, not one: `wafPreBody` runs before body parsing (inspects URL/query/headers/IP), `wafPostBody` runs after (inspects `req.body`, no-ops on multipart). Do not reorder them in `index.ts`.
- **Logger meta is PHI-scrubbed** recursively via `phi-redactor.ts` in `logger.emit()` (depth=6, WeakSet cycle detection, 10KB string cap). Formatted numeric strings that look like phone numbers will show as `[REDACTED-PHONE]` in log output.
- **Sentry fully removed** — `server/services/sentry.ts` and `client/src/lib/sentry.ts` export no-op stubs. `@sentry/node` and `@sentry/react` are no longer in `package.json`. Existing callsites (~30) still import `captureException`/`captureMessage` from the stub modules and compile unchanged. Error tracking is handled by the structured JSON logger → AWS CloudWatch Logs + Alarms.
- **Global error response shape is transitional**: `{ message, error: { code, message, detail? } }`. Both fields are populated in batch 1. The top-level `message` will be removed in batch 2 once all frontend handlers read from `error.message`.
- Bedrock AI responses may contain objects where strings are expected — always use `toDisplayString()` on frontend and `normalizeStringArray()` on server when rendering/storing AI data
- The same IAM user is shared across 3 projects (CallAnalyzer, RAG Tool, PMD Questionnaire) — IAM policy covers S3, Bedrock, and Textract
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- The `useQuery` key format is `["/api/calls", callId]` — TanStack Query uses the key for caching
- **Query 401 handling**: The default `queryFn` uses `on401: "returnNull"` — background queries silently return null on 401 instead of killing the session. **Never change the default to "throw"** — this causes any single failed query (sidebar, background refetch, stale tab) to destroy the user's session. Session expiry is handled exclusively by the `/api/auth/me` query in `AuthenticatedApp`. See `tests/session-integration.test.ts` for the rationale.
- **Session fingerprint**: `getSessionFingerprint()` in `server/auth.ts` is the **single source of truth** — both login (`routes/auth.ts:bindSessionFingerprint`) and verification (`auth.ts:requireAuth`) must use the same exported function. Uses `hash(ua + lang)` — IP intentionally excluded (mobile/VPN rotation). Test coverage in `tests/auth.test.ts` and `tests/session-integration.test.ts`.
- In-memory storage backend loses all data on restart — only use for local development without cloud credentials
- Without `DATABASE_URL`, sessions use memorystore (lost on restart) and job queue falls back to in-memory TaskQueue (no retry on crash)
- PostgreSQL schema auto-initializes on startup (`server/db/pool.ts:initializeDatabase`) — no manual migration step needed
- AssemblyAI costs: $0.15/hr base + $0.02/hr sentiment = $0.17/hr ($0.0000472/sec)
- AssemblyAI uses `speech_models: ["universal-3-pro", "universal-2"]` — Universal-3 Pro is the highest accuracy model with fallback to Universal-2 for unsupported languages
- Bedrock Batch Mode (`BEDROCK_BATCH_MODE=true`) saves 50% on AI analysis costs but results are delayed (up to 24 hours). Calls show as "awaiting_analysis" until batch completes.
- `DATABASE_URL` in `.env` must NOT use double quotes around the value (dotenv includes the literal `"` characters). URL-encode special chars in the password instead (e.g. `!` → `%21`, `@` → `%40`, `#` → `%23`)
- `deploy.sh` sets `NODE_OPTIONS="--max-old-space-size=1024"` to prevent OOM on memory-constrained EC2 instances (applies to tsc, tests, and build)
- When changing `.env` on EC2, use `pm2 delete` + `pm2 start` (not `pm2 restart`) — pm2 caches environment variables from the original process. Also `unset` any shell-exported overrides first.
- `AUTH_USERS` password complexity is enforced at startup — if a password fails validation (12+ chars, upper/lower/digit/special), the user is **silently skipped** with a `[SECURITY] Rejecting AUTH_USERS entry` log message
- Employee schema validates email format (`.email()`), status is enum (`Active`/`Inactive`), coaching category is enum (not freeform string)
- Search page filters sync to URL params — all filters are bookmarkable and restored on page load
- Scoring thresholds (LOW_SCORE 4.0, HIGH_SCORE 9.0, STREAK 8.0) are centralized in `server/constants.ts` — LOW/HIGH are env-configurable via `SCORE_LOW_THRESHOLD` / `SCORE_HIGH_THRESHOLD`
- Password complexity is enforced in Zod schemas (`createDbUserSchema`, `resetPasswordSchema`, `changePasswordSchema`) — 12+ chars, uppercase, lowercase, digit, special character
- Auto-calibration: admin can apply recommended values via `POST /api/admin/calibration/apply`. Runtime overrides are persisted to S3 (`calibration/active-config.json`) and loaded on startup. Guard rail: max ±0.5 shift per application. History tracked under `calibration/history/`.
- `AUTH_USERS` entries require at least 3 colon-separated parts (`username:password:role`) — 2-part entries (missing role) are now rejected with a warning instead of silently defaulting to "viewer"
- Scoring calibration `spread` parameter is clamped to [0.1, 5.0] — extreme values can no longer distort all scores. `center` and thresholds clamped to [0, 10].
- `npm test` uses `--test-force-exit` flag — imported modules (webhooks, audit-log) start `setInterval` timers that prevent Node from exiting naturally
- Standardized error responses: all routes use `sendError(res, status, message)` and `sendValidationError(res, message, zodError)` from `server/routes/utils.ts` — Zod errors always use `.flatten()` format
- Role badge colors/labels are centralized in `client/src/lib/constants.ts:ROLE_CONFIG` — used by admin.tsx and auth.tsx
- `COMPANY_NAME` env var controls company name in snapshots, coaching prompts, and transcription word boost (default: "UMS (United Medical Supply)")
- Bedrock embedding LRU cache (200 entries, keyed by content SHA-256) — avoids redundant API calls on re-analysis
- `parseJsonResponse` attempts nested unwrap recovery when AI wraps response in `{ analysis: { ... } }` — detects all-defaults quality gate and extracts inner object
- Security monitor tracking Maps (failedLoginsByUser, failedLoginsByIP, bulkAccessByUser) are capped at 10,000 entries with LRU eviction
- In-memory incidents array capped at 500 (evicts oldest closed first)
- `tsconfig.json` uses `target: "ES2022"` — do NOT add `downlevelIteration` or `baseUrl` (deprecated in TS 7.0)
- **`storage.updateCall` rejects `employeeId`** (A6/F14) — passing it throws `Error: updateCall: employeeId cannot be modified via updateCall — use atomicAssignEmployee or setCallEmployee`. First-time assign → `atomicAssignEmployee`; manager reassign/unassign → `setCallEmployee(callId, employeeId | null)`.
- **Production boot requires `S3_BUCKET`** (A1) — when `DATABASE_URL` is set in production, missing `S3_BUCKET` causes `createStorage()` to throw at startup. Set it in `.env` on EC2 before deploy.
- **`updateCallAnalysis` throws on unknown keys** (A5) — only `embedding`, `manualEdits`, `performanceScore`, `summary` are accepted (`UPDATE_ANALYSIS_COLUMNS`). Adding a new updateable analysis field requires both a COLUMN_MAP entry and an `UpdateCallAnalysisInput` type addition.
- **PostgresStorage `updateCall` silently ignores unknown keys** — only keys in COLUMN_MAP are sent to SQL. Adding a new persisted call field requires both a schema migration and a COLUMN_MAP entry, or the value will appear to save but vanish on re-read.
- **`STORAGE_BACKEND=s3` now throws at boot** (A12) — old value is rejected with a migration message. To run the deprecated CloudStorage backend, use `STORAGE_BACKEND=s3-legacy` (which logs a deprecation WARN). Bare `S3_BUCKET` no longer activates CloudStorage either — without `DATABASE_URL` or an explicit `STORAGE_BACKEND`, the app falls through to MemStorage.
- **`PostgresStorage.createBadge` only handles ON CONFLICT for milestone badge types** (A14) — `MILESTONE_BADGE_TYPES` is a static set (`first_call`, `calls_25`, `calls_50`, `calls_100`). Adding a new milestone-style badge requires updating both that set *and* the corresponding `UNIQUE (employee_id, badge_type)` partial constraint in `schema.sql`, or the new type will throw on duplicate insert.
- **`MemStorage.createCall` enforces `content_hash` uniqueness** (A13) — throws a pg-23505-shaped error on duplicate hash, mirroring the PostgresStorage UNIQUE INDEX. Dev fixtures that intentionally create duplicate-hash calls will now fail.
- **`talkTimeRatio` is `null` until agent speaker is identified** (A4/F06) — `processTranscriptData` previously assumed Speaker A was always the agent and stored a misleading 0.5 fallback. It now takes an optional `agentSpeakerLabel` and stores `undefined` (NULL in DB) when the label is unknown. Pipeline computes the label from `aiAnalysis.detected_agent_name` *before* calling `processTranscriptData`. Any future consumer must handle `null` instead of expecting a default.
- **`BEDROCK_BATCH_MODE=true` requires `BEDROCK_BATCH_ROLE_ARN`** (A1/F02) — `bedrockBatchService.isAvailable` returns false (and logs an error once) if the role ARN is missing. Mode silently disables itself and falls back to on-demand. Previous behavior submitted jobs that AWS rejected with cryptic 4xx errors.
- **`bedrockBatchService` resolves credentials lazily** (A1/F16) — credentials come from `getAwsCredentials()` (env vars → IMDSv2) on the first AWS call, not at module construction. EC2 instance profiles now work for batch mode. First batch op pays one IMDS round-trip.
- **Scoring corrections survive restarts** (A2/F11) — `loadPersistedCorrections()` is called from `server/index.ts` startup as fire-and-forget after `initWebhooks`; it lists `corrections/` from S3 and rehydrates the in-memory feedback store (capped at MAX_CORRECTIONS=200). Without it, the feedback loop only worked for the lifetime of one process.
- **`/api/admin/jobs/:id` MFA bypass — FIXED** — `requireMFASetup` is now applied directly on the route handler in `snapshots.ts`, independent of the `router.use` mount ordering in `routes.ts`.
- **`PerformanceMetrics` 3 new fields default in the mapper** (A11/F25) — `lowConfidenceCallCount`, `promptInjectionCallCount`, `outputAnomalyCallCount` are required `number` fields. `rowToSnapshot` defaults each to 0 when the JSONB blob lacks the key (pre-A11 rows), so consumers never see `undefined`/`NaN`. No DB backfill required. Historical snapshots will report 0 for these counts until they're regenerated; new snapshots capture real values.
- **`aggregateMetrics` was reading wrong sub-score key for months** (A10/F22) — `aggregateMetrics` was reading `sub.customer_experience` (snake_case) but the pipeline normalizes to `customerExperience` (camelCase) before persistence (`routes/pipeline.ts:489`). Every snapshot generated before this fix has CX sub-score frozen at 0 in its JSONB `metrics`. **No backfill was performed.** New snapshots are correct; old snapshots lie about CX.
- **Sub-scores are camelCase in storage but snake_case at the AI provider boundary** — `assemblyai.ts` and `scoring-calibration.ts` work in snake_case (`customer_experience`); `pipeline.ts:489` normalizes to camelCase (`customerExperience`) before storing. Anything reading `analysis.subScores` from storage must use camelCase keys; anything reading the raw AI response must use snake_case. The dual representation is a footgun for the next person — A10 was a one-off fix in the aggregator, the inconsistency remains.
- **`POST /api/snapshots/batch` returns 202 + jobId when DATABASE_URL is set** (A8/F18) — was previously `201 + { employees, teams, departments, company, errors }` synchronously. Frontend must detect 202 and poll `GET /api/admin/jobs/:id` until `status === "completed"`, then read `payload.results`. Synchronous fallback only fires without a job queue (i.e. dev). The "Generate Batch Snapshots" admin button is broken until the frontend updates.
- **`/api/insights` defaults to a 90-day window** (A4/F15) — was previously unbounded (full-table scan over every call ever uploaded). Pass `?days=N` (max 365) to widen. Existing dashboards that depended on all-time data will visibly change.
- **Leaderboard cached for 60s, not invalidated on badge insert** (A4/F13) — `getLeaderboard(period)` uses an in-memory cache keyed by period (`week`/`month`/`all`). Newly earned badges or completed calls take up to 60s to appear on the leaderboard. `clearLeaderboardCache()` is exported as a test seam but is NOT called from `evaluateBadges`. If real-time updates are needed, add the call there.
- **`saveSnapshot`/`resetSnapshotContext` rethrow DB errors now** (A6/F09) — was silently swallowed before. Snapshot generation routes wrap `saveSnapshot` in try/catch; the `DELETE /api/snapshots/:level/:targetId/reset` route does NOT, so failures now propagate as 500 via the global error handler (was silent 200 with `removed: 0`). The HIPAA `logPhiAccess` audit entry for `snapshot_context_reset` is written AFTER the DB delete, so a DB failure also skips the audit log.
- **`scheduled_reports` has `UNIQUE(type, period_start)`** (A3/F02) — concurrent scheduler triggers and catch-up runs are idempotent (`INSERT … ON CONFLICT DO NOTHING`); duplicate periods return the existing row. `runCatchUp()` walks back up to `CATCH_UP_WEEKLY_LOOKBACK=12` Mondays and `CATCH_UP_MONTHLY_LOOKBACK=12` 1st-of-months on startup AND on every hourly `checkAndGenerate` tick (#7) — idempotent via `reportExistsForPeriod` short-circuit, so the hourly call is cheap when nothing is missing. Recovers failed mid-hour reports within an hour instead of waiting for process restart. Previously only the most-recent missed boundary was recovered, so a month-long outage silently lost all but the latest weekly and latest monthly report. `generateReport` is pure SQL aggregation so filling up to 24 slots on first boot is cheap (~seconds).
- **Snapshot generation helpers are module-level exports** (A8/F18) — `generateEmployeeSnapshot`, `generateTeamSnapshot`, `generateDepartmentSnapshot`, `generateCompanySnapshot`, `generateBatchSnapshots` exported from `server/routes/snapshots.ts`. The job worker dynamically imports them; other services may also call them directly. Lifted out of the `registerSnapshotRoutes` closure.
- **`most_improved` removed from `BADGE_TYPES`** (A13/F10) — never had a code path that awarded it. Pre-existing rows in `badges` with `badge_type='most_improved'` (if any) render with the raw string instead of a label/icon/description because `BADGE_TYPES.find()` returns undefined. Run `SELECT count(*) FROM badges WHERE badge_type='most_improved'` before deploy.
- **`/api/reports/filtered` `?role` query param** (A15/F14) — was `?department`; renamed because the filter compares against `employees.role`, not a separate department column. Old name accepted as a deprecated alias during the transition. `decodeURIComponent` applied so percent-encoded values like `Customer%20Service` match.
- **`validateDate` clamps to 2000–2100** (A14/F23) — values outside the window are treated as undefined. `parseDate` in `routes/utils.ts` does NOT have the same clamp; parallel validation paths exist for historical reasons.
- **`useConfig()` is the way to read tenant-tunable values** (A11/A27, Batch 2) — `client/src/hooks/use-config.ts` returns `FALLBACK_CONFIG` on first render and re-renders with the server value once `/api/config` resolves. Components must use the hook rather than importing `DEFAULT_COMPANY_NAME` / `LOW_SCORE_THRESHOLD` directly. The static constants in `client/src/lib/constants.ts` are fallbacks only. For tenants whose `COMPANY_NAME` differs from "UMS (United Medical Supply)", users see a brief fallback flash — acceptable because pages don't gate on the value. **Shape**: the hook returns BOTH `companyName` (tenant name, used by backend AI prompts) AND `appName` (product brand, hardcoded "CallAnalyzer", used in UI chrome like the `auth.tsx` login CardTitle). Component tests that `vi.mock("@/hooks/use-config", ...)` MUST return both fields — omitting `appName` renders an empty title. `client/src/pages/auth.test.tsx` is the canonical reference for the correct mock shape.
- **`useWebSocket` mount-once-per-mount** (A13, Batch 2) — the mount effect runs exactly once per mount because `toast` / `t` / `queryClient` are captured in refs (`toastRef`, `tRef`, `qcRef`). Adding a new dep to `connect()` or `scheduleReconnect()` MUST go through a corresponding ref via a separate `useEffect`, not appended to the `useCallback` dep array. Otherwise the WebSocket will be torn down on every dep change. Contract preserved: `window.dispatchEvent("ws:call_update", { detail })` still fires with the same detail shape — subscribers in `calls-table.tsx`, `sidebar.tsx`, and `file-upload.tsx` are unaffected.
- **`SessionExpiredError` and `ApiError` carry a structured `code` field** (A12, Batch 2) — `apiRequest` reads the response body via `res.clone().json()`, extracts `body.code` (or `body.error.code` for the new shape), and attaches it to the thrown error. Callers should branch on `error.code` (e.g. `"mfa_session_expired"`) rather than substring-match `error.message`. **Caveat**: `SessionExpiredError` is also thrown for the MFA-step 401 even when there's no active session — the class name is misleading; planned rename to `AuthFlowError`.
- **`/api/employees/teams` route ordering** (A28, Batch 2) — `GET /api/employees/teams` is registered BEFORE `GET /api/employees` in `server/routes/employees.ts:register`. Any future `GET /api/employees/:id` handler must be registered AFTER `/teams`, OR validate the param against UUID format to reject `"teams"` explicitly. Express matches in registration order.
- **`client/src/components/ui/sidebar.tsx` and `client/src/hooks/use-mobile.tsx` are deleted** (A31, Batch 2) — only the hand-rolled `client/src/components/layout/sidebar.tsx` exists. The shadcn vendor sidebar was 771 lines of dead code with zero consumers. Don't reintroduce the shadcn variant without an explicit consumer.
- **Score tier thresholds: client-side migration complete** (A11, Batch 2) — all client pages that render score-based color coding now import `SCORE_EXCELLENT/GOOD/NEEDS_WORK` from `@/lib/constants`. Drift risk on threshold changes is resolved at the client layer; keep the client constants in lock-step with `server/constants.ts` until `useConfig()` replaces them fully.
- **`safeSet` from `client/src/lib/safe-storage.ts` is the way to write to localStorage** (A9, Batch 1) — wraps `localStorage.setItem` to swallow QuotaExceededError, SecurityError (Safari private mode), and SSR. `dashboard-config`, `saved-filters`, `appearance`, and `i18n` all use it. New persistence code should follow the same pattern, not call `localStorage.setItem` directly.
- **`/api/calls` cache key convention** (A14, Batch 2) — omit the filter object entirely from the query key when no filters are set (use `["/api/calls"]`, not `["/api/calls", { status: "", sentiment: "", employee: "" }]`). Empty-string sentinels create cache keys that don't match the filterless invalidation pattern used by mutations (e.g. upload-complete webhook invalidation). Dashboard, sidebar, search, and sentiment all follow this convention. Search builds the key from only the non-default filters (all 8: sentiment, status, employee, dateFrom, dateTo, minScore, maxScore, and searchQuery for /api/search).
- **`loadAuditIntegrityChain()` now hard-fails after 3 retries** (F01) — previously silently forked the HMAC chain from "genesis" on DB failure. Now retries 3x (1s, 2s, 4s exponential backoff) and throws on exhaustion. Server refuses to start with a broken integrity chain. Ensure DB is accessible within ~7 seconds of `initializeDatabase()` completing.
- **`getCallAnalysesBulk(callIds)` added to IStorage** (F03) — bulk-fetches analyses in a single SQL query (chunked IN clause, 500 per chunk). Used by auto-calibration to eliminate N+1 query pattern. All 3 backends implement it.
- **Batch orphan recovery treats missing `uploadedAt` as epoch** (F05) — previously `call.uploadedAt || Date.now()` produced age ≈ 0, causing calls without `uploadedAt` to never be recovered. Now uses epoch (1970), making such calls immediately eligible for orphan recovery.
- **Idle timeout catch path calls server logout** (F06) — the fail-closed `catch` in `useIdleTimeout` now POSTs to `/api/auth/logout` before hard-redirecting to `/auth`. Previously only did the redirect, leaving the server session valid.
- **`/api/reports/filtered` and `/api/insights` use DB-level aggregation** (F35) — previously loaded all completed calls (with full transcript text) into Node.js memory and filtered/aggregated in JS. Now uses `getFilteredReportMetrics()` (4 parallel SQL queries) and `getInsightsData()` (lightweight SELECT without transcript join). Do not reintroduce `getCallsWithDetails({ status: "completed" })` or `getCallsSinceWithDetails()` in these routes — the old pattern causes OOM at production scale.
- **Scoring quality alerts and regression detection run inside the calibration scheduler** — `checkScoringQuality()` and `detectScoringRegression()` in `server/services/scoring-feedback.ts` run after each `analyzeScoreDistribution()` cycle (default every 24h). Quality alerts detect high correction rates (>15% warning, >25% critical) and systematic bias (>75% of corrections in the same direction). Regression detection compares week-over-week mean score distributions and flags shifts >0.8 points (warning) or >1.5 points (critical). Both exposed via `GET /api/admin/calibration` response (`qualityAlerts` + `correctionStats` fields) and `GET /api/admin/health-deep`. Non-blocking — failures don't affect calibration.
- **Scoring-correction `reason` is sanitized + wrapped in `<<<UNTRUSTED_MANAGER_NOTES>>>`** (S2-C1) — `sanitizeReasonForPrompt()` in `server/services/scoring-feedback.ts` strips control chars, delimiter-manipulation chars (`` ` {}<>[]\ ``), collapses whitespace, and caps at 500 chars. Applied BOTH at capture time in `recordScoringCorrection()` and at render time in `buildCorrectionContext()`. Legacy corrections hydrated from S3 are re-sanitized on render. The rendered block is wrapped in `<<<UNTRUSTED_MANAGER_NOTES>>> … <<</UNTRUSTED_MANAGER_NOTES>>>` with explicit prompt instructions telling the model to treat the content as reference only. Do not remove the delimiter wrap or weaken the sanitizer without re-evaluating the prompt-injection surface.
- **`aiProvider.setModel()` and `bedrockBatchService.setModel()` are both called by `promoteActiveModel()`** — previously a known asymmetry; now symmetric. `bedrockBatchService` exposes `setModel(modelId)` and a `modelId` getter mirroring `BedrockProvider`. Both on-demand and batch paths observe promotions without a restart. Caveat: in-flight batch jobs (already submitted to AWS) are NOT re-targeted; they run to completion on their submitted model. The swap only affects NEW batch submissions after the promotion.
- **`requireAuth` is now `async`** — the fingerprint-mismatch branch awaits both `req.logout()` and `req.session.destroy()` before responding 401 to prevent a window where a failed destroy left the cookie valid on the session store. Happy path is unaffected. Destroy failures are logged via `logger.error`. Express 4.21 handles the async middleware; downstream composers must not assume `requireAuth` returns synchronously.
- **`DELETE /api/calls/:id/tags/:tagId` enforces author-or-manager** — previously any authenticated user (including viewers) could delete any tag. The handler now does a SELECT-then-author-check-then-DELETE, mirroring the annotation delete pattern at the same file's `DELETE /api/calls/:id/annotations/:annotationId`. The author check compares `created_by` against `username` first (matching creation, which stores `req.user.username`), then display `name` as fallback (F-08). Manager/admin can always delete.
- **`advanceIncidentPhase`, `addIncidentTimelineEntry`, `addActionItem`, `updateIncidentDetails` are all DB-first via clone pattern** — each builds the new state on a shallow clone (with new timeline / actionItems arrays constructed by spread, not push), calls `persistIncident()` first, and only applies the mutation to the in-memory `incident` object on successful persist. Previously a failed persist left the in-memory cache ahead of the DB. `updateIncidentDetails` was the last remaining mutate-then-persist instance, converted in F-13.
- **Audit queue overflow: drop-oldest + logger escalation** — `MAX_QUEUE_SIZE=20000` in `server/services/audit-log.ts` gives ~20MB of runway under sustained DB outage. When full, the OLDEST entry is shed from the DB write path (head of queue is most likely already toxic with failed retry attempts). The canonical non-repudiable record remains in stdout via the HMAC chain, so operators can reconstruct the missing rows from captured pm2/CloudWatch logs by walking the `[HIPAA_AUDIT]` lines. The first drop per process escalates via `logger.error` — operators get alerted once per outage via CloudWatch Alarms, not per dropped entry. Subsequent drops in the same process log via `logger.error` but do not re-alert.
- **Batch inference tracking-write has retry + orphan fallback** — after `bedrockBatchService.createJob()` succeeds, the AWS job is running and billable. If the subsequent `batch-inference/active-jobs/${jobId}.json` write fails, the job becomes invisible to CallAnalyzer. `persistBatchJobTracking()` in `batch-scheduler.ts` retries 3× with exponential backoff (1s/2s/4s), then falls back to writing `batch-inference/orphaned-submissions/${jobId}.json` so the job data still lives in S3 under a known prefix. `promoteOrphanedSubmissions()` scans that prefix at the top of every batch cycle and promotes surviving entries back to `active-jobs/`, then deletes the orphan copy. In all tracking-write failure paths, a `logger.error` fires with the jobId and jobArn — those are the recovery keys an operator uses to manually reconstruct the active-jobs file from the AWS console if even the orphan write fails.
- **`/api/users/me/password` and `/api/auth/mfa/disable` both require `requireMFASetup`** — every manager/admin-gated mutation now passes through `requireMFASetup` (no-op when `REQUIRE_MFA=false`). Viewers are exempt because `isMFARoleRequired()` only returns true for admin/manager. Previously an admin without MFA enrolled could change their password OR disable another admin's MFA even when `REQUIRE_MFA=true` — both are now gated, closing the last per-route INV-14 gap.
- **`validateTimestamps` flags `output_anomaly:invalid_feedback_timestamps:N`** (S2-H5) — when Claude returns a feedback timestamp beyond call duration (hallucinated moment), `validateTimestamps` in `server/services/ai-provider.ts` strips the timestamp, emits `logger.warn` with the callId + strip count + up to 3 example stripped timestamps, and appends `output_anomaly:invalid_feedback_timestamps:${count}` to `analysis.flags`. Uses the same `output_anomaly:*` prefix convention as `prompt-guard.ts` so existing flag-surfacing UI picks it up. Previously strips were silent — a hallucinated timestamp looked identical to "AI didn't provide a timestamp" and hid a real model-quality regression from reviewers. Reinforces the "no silent defaults" A12/F17 invariant.
- **`isPasswordReused` defensively caps history at `PASSWORD_HISTORY_SIZE`** — `server/auth.ts:isPasswordReused` slices the passed-in history array to the first 5 entries before running scrypt compares. The write path (`updateDbUserPassword`) already trims to 5 on every update, so this only differs from old behavior if the stored array has drifted past 5 (migration bug, direct DB write, etc.). Without the cap, each entry runs a ~100ms scrypt compare — an unbounded array would turn password reuse checks into a CPU DoS surface. Ordering: the write path stores `[newestHash, ...oldHistory].slice(0, 5)`, so newest is at index 0 and `slice(0, 5)` gives the most recent 5.
- **MFA recovery codes are single-use + display-once** — `generateRecoveryCodes` in `server/services/totp.ts` returns plaintext exactly once (at enable or regenerate). Codes are stored scrypt-hashed in `mfa_secrets.recovery_codes` JSONB as `{ hash, used, usedAt? }` records; plaintext is never recoverable. Users MUST save them immediately. `consumeRecoveryCode` marks matched records `used: true` and is timing-safe on the hash compare (does NOT short-circuit on early match) so an attacker cannot distinguish "no such code" from "already used" via timing. Pre-existing MFA-enrolled users after the ae2f30c deploy have 0 recovery codes until they click "Regenerate Recovery Codes" — not broken, just voluntary. `GET /api/auth/mfa/status` surfaces `recoveryCodesRemaining`; the UI nags when ≤2.
- **MFA per-token attempt counter caps brute force at 5** — `mfaPendingTokens` entries in `server/routes/auth.ts` track `attempts`; the cap is the hardcoded constant `MFA_MAX_ATTEMPTS = 5` (not env-configurable — if stricter is needed, code change required). On exhaustion the token is deleted and the user must re-enter their password for a fresh MFA challenge. The outer per-IP login limit (5/15min) still applies independently. Audit events `mfa_verification_failed` (with `attempt N/5`), `mfa_verification_locked`, `mfa_session_expired` surface the state to compliance review.
- **Batch result processor skips calls already in "completed" status** — `batch-scheduler.ts:processBatchResults` calls `storage.getCall(callId)` before `createCallAnalysis`. If `call.status === "completed"` (e.g., a manager edited the analysis, an on-demand re-run produced fresh results, or the same call was submitted to batch twice), the result is skipped and the pending S3 item is deleted. Prevents batch results from clobbering manager corrections. Pending cleanup still runs so orphan recovery stays correct.
- **Graceful shutdown calls four scheduler stop functions in sequence** — `server/index.ts:gracefulShutdown` invokes `stopBatchScheduler`, `stopCalibrationScheduler`, `stopTelephonyScheduler`, `stopReportScheduler` (each wrapped in an independent try/catch so one failure doesn't skip the others) before `jobQueue.stop()` and `flushAuditQueue()`. All scheduler `setTimeout`/`setInterval` handles have `.unref()` as defense-in-depth — and per INV-30, so do the module-level middleware timers (rate-limit + WAF anomaly/cleanup maps) and the WebSocket ping heartbeat. Any new module-level timer MUST call `.unref()` or it will block graceful shutdown for up to its interval length. Any new scheduler MUST export a top-level `stop*Scheduler()` function and be added to this sequence — in-closure stop callbacks returned by the start function are not reachable from shutdown.
- **Sentry dynamic-import escalation paths removed** — `audit-log.ts` queue-overflow alert, `batch-scheduler.ts:escalateOrphanedJob`, and `routes/utils.ts:warnOnUnknownBedrockModel` no longer call `import("./sentry").then(({ captureMessage }) => ...)`. Escalation is now via `logger.error`/`logger.warn` with structured `alert:` tags (`audit_queue_overflow`, `batch_orphan_escalation`, `bedrock_unknown_model`). CloudWatch metric filters match these tags. Existing `captureException`/`captureMessage` stub imports in pipeline/auth/snapshot paths are still no-op and compile unchanged.
- **`createCallAnalysis` is an UPSERT that preserves `manual_edits`** (F-04) — all three storage backends (PostgresStorage, CloudStorage, MemStorage) now route a duplicate-call_id insert to an UPDATE that keeps the existing `manual_edits` array (COALESCE on Postgres, fallback on the JS backends). This makes bulk-reanalyze of completed calls work without losing manager corrections. Previously a second `createCallAnalysis` for the same call_id threw pg 23505 and the call was marked "failed". Fresh inserts behave identically to before.
- **Bedrock circuit breaker only trips on 5xx + 429** (F-17) — `bedrock.ts` throws `BedrockClientError` for 4xx responses (except 429 throttling) and passes `isCircuitFailure` into `bedrockCircuitBreaker.execute()` as the failure predicate. A single bad prompt template no longer brownouts the pipeline for 30s. All errors still surface to the caller — only the circuit-breaker counting behavior changed.
- **Bedrock batch submissions share the breaker with on-demand** (F-18) — `bedrockBatchService.createJob` and `getJobStatus` wrap their fetches in `bedrockCircuitBreaker.execute(..., isCircuitFailure)`. During a Bedrock regional outage, batch submissions are rejected by the open breaker the same way on-demand calls are. 4xx (except 429) still surfaces to the caller without tripping. `readBatchOutput` reads from S3 and is intentionally unwrapped.
- **`useIdleTimeout` resets on `visibilitychange→visible`** (F-03) — without this, a user blurred to another tab for >15 minutes returned to find themselves logged out with no warning ever fired (the warning's countdown ran in the background while the tab was hidden). The handler explicitly checks `document.visibilityState === "visible"` before resetting; tab-hidden does NOT reset, so HIPAA timeout still applies for users away from their machine.
- **Batch result with missing transcript marks call `failed` immediately** (F-06) — `batch-scheduler.ts:processBatchResults` previously did a silent `continue` with only a warn when a pending S3 item was missing `transcriptResponse`, leaving the call in `awaiting_analysis` until orphan recovery (2h threshold) caught it. Now it `storage.updateCall(callId, { status: "failed" })` + `broadcastCallUpdate` + cleans up the pending item via the existing finally block.
- **A/B test page keeps polling after completion** (F-21) — `refetchInterval` is `5000` while any test is processing and `30000` otherwise (was `false` after completion, leaving the page stuck on stale data when a second test was uploaded in the same session). `refetchOnWindowFocus: true` also added so the page never shows stale data after a long blur.
- **`REQUIRE_MFA=true` blocks ENV-VAR admin/manager users at login** (F-06) — ENV-VAR users (`AUTH_USERS`) cannot enroll in MFA (no DB row to store TOTP secret). When `REQUIRE_MFA=true`, admin/manager ENV-VAR users are rejected at login with a message directing operators to create DB users instead. Viewer-role ENV-VAR users are unaffected. Operators who rely on `AUTH_USERS` for admin access must create equivalent DB users before enabling `REQUIRE_MFA`.
- **User deactivation immediately purges active sessions** (F-12) — `DELETE /api/users/:id` now deletes all matching rows from the PostgreSQL `session` table (`sess::jsonb->'passport'->>'user' = $1`) after deactivation. Non-blocking — if the purge fails, `deserializeUser` already checks `active` flag on the next request (up to 15-min residual window). Without `DATABASE_URL` (memorystore), the purge is skipped.
- **Scoring correction S3 filenames include timestamp prefix** (F-22) — new corrections use `corrections/<ISO-timestamp>_corr-<uuid>.json` so S3 lexicographic listing order matches chronological order. Old files (`corrections/corr-<uuid>.json`) still load and sort correctly by `correctedAt`. `loadPersistedCorrections()` uses `keys.slice(-N)` which now grabs the most recent files.
- **RAG context wrapped in `<<<UNTRUSTED_KNOWLEDGE_BASE>>>` delimiters** (F-16) — `buildAnalysisPrompt` in `server/services/ai-provider.ts` wraps knowledge base content in untrusted delimiters with explicit instructions to the model, matching the scoring-correction pattern (INV-07). Do not remove the delimiter wrap without re-evaluating the prompt-injection surface from KB documents.
- **Embedding cache key includes model ID** (F-19) — `getEmbeddingCacheKey` in `server/services/bedrock.ts` now hashes `${model}:${text}` instead of just `text`. A runtime change to `BEDROCK_EMBEDDING_MODEL` invalidates the cache (brief spike of Bedrock API calls until re-warmed). Previously stale cached vectors with different dimensionality could be returned.
- **`filterCallsByDateRange` uses UTC end-of-day** (F-17) — `setUTCHours(23, 59, 59, 999)` instead of `setHours()`. Date-filtered reports now use UTC-consistent boundaries. Previously the end-of-day boundary was local timezone, causing ±12h errors on non-UTC servers.
- **Auto-calibration uses sample variance (N-1)** (F-23) — `server/services/auto-calibration.ts` divides by `(rawScores.length - 1)` for Bessel's correction. Reported stdDev is ~2.5% higher than before (for N=20), which may cause marginal drift to newly trigger calibration recommendations.
- **Viewer-scoped data access** (#1 Phase 1+2+3+4) — Viewer-role users are restricted to their own data on agent-specific and call endpoints via three helpers: `getUserEmployeeId(username, displayName)` in `server/auth.ts` (matches user→employee via email→username then name→displayName), `requireSelfOrManager(req => req.params.employeeId)` in `server/auth.ts` (middleware factory), and `canViewerAccessCall(req, call)` exported from `server/routes/calls.ts` (per-call employee match, unassigned calls allowed). Scoped endpoints fall into three groups: (1) **agent-scoped, return 403**: `/api/reports/agent-profile/:id`, `/api/reports/agent-summary/:id`, `/api/gamification/{badges,stats}/:id`, `/api/analytics/{trends/agent,health-pulse}/:id`, `/api/snapshots/employee/:id`. (2) **call-scoped, filter list or return 403**: `/api/calls` (list), `/api/calls/:id[/audio|transcript|sentiment|analysis]`, `/api/calls/:id/{tags,annotations}`, `/api/calls/by-tag/:tag`, `/api/search`, `/api/analytics/speech/:callId`. (3) **Phase 4 — filter forced to self**: `/api/reports/filtered` (viewer's `employeeId` always applied), `/api/analytics/heatmap`, `/api/analytics/clusters`. Phase 4 also **restricts to manager+**: `/api/analytics/team/:teamName`, `/api/analytics/speech-summary`. **Kept open to viewers intentionally**: `/api/analytics/trends` (aggregate), `/api/analytics/teams` (team-level aggregates only), `/api/dashboard/performers` (top-3 motivation widget), `/api/gamification/leaderboard` (public ranking by design). Manager/admin paths unchanged throughout. Unassigned calls (no `employeeId`) remain visible to viewers to cover the upload→auto-assign window. Client-side: `requireRole` on the team-analytics sidebar nav hides the entry from viewers (the page itself would return empty-aggregates-only data, but the nav gate avoids confusion). **Operator note**: a viewer user with no matching employee row (email/name mismatch) sees empty lists and 403s with no warning — ensure employee records use the same email as the user's login.
- **`persistIntegrityChainHead()` runs in graceful shutdown** (#6) — exported from `server/services/audit-log.ts` and called in `server/index.ts` at step 3a (before `flushAuditQueue`). Persists the in-memory HMAC chain head to `audit_log_integrity` so the next boot picks up the correct position even if fire-and-forget `persistPreviousHash` writes from `computeIntegrityHash` were in-flight when shutdown started. Failure is non-blocking (try-catch wrapped) — stdout HMAC chain remains canonical. HIPAA §164.312(b).
- **CI has backend coverage gate at 45%** (#5) — `.github/workflows/ci.yml` `test & build` job runs `npm run test:coverage` and fails if statement coverage drops below 45% (current ~46%, 1% headroom). Threshold was originally set at 65% based on outdated docs claiming ~67% coverage; actual measurement is 46.32%. Threshold lowered to unblock CI; raising it requires a test-coverage push. Coverage threshold is hardcoded in the workflow, not in `package.json`.
- **CI E2E job runs Playwright chromium (non-blocking)** (#5) — separate `e2e` parallel job installs chromium with `--with-deps` and runs `npm run test:e2e` against the dev server (started by Playwright's `webServer` config). Uses CI-specific `SESSION_SECRET` and `AUTH_USERS` env vars defined in the workflow. Artifact `playwright-report/` uploaded on failure with 7-day retention. **Currently `continue-on-error: true`** — the 4 specs added in PR #122 haven't been debugged in a CI environment and consistently fail. Failures should be investigated but don't block PR merges. Sprint 3 (test expansion) will fix this.

## Systems Map

### Module Map

| Module | Files | Responsibility |
|--------|-------|---------------|
| **Server Entry** | `server/index.ts`, `server/vite.ts`, `server/types.d.ts` | Express bootstrap. Middleware order: X-Forwarded-For validation → correlation ID (UUID-validated, truncated, falls back to randomUUID) → HTTPS redirect → CORS → `wafPreBody` → `express.json({limit:"1mb"})` → `express.urlencoded({limit:"1mb"})` → `wafPostBody` → security headers → audit logging → CSRF double-submit (timingSafeEqual on hashed tokens) → legacy CSRF Content-Type check → routes → `globalErrorHandler` (AppError-aware, transitional `{message, error:{...}}` shape, prod 5xx sanitization). Env validation, graceful shutdown, Vite dev server integration. `types.d.ts` holds Express.User and SessionData type augmentations. |
| **Route Coordinator** | `server/routes.ts` | Registers all 13 sub-routers, configures multer, initializes job queue + batch scheduler + calibration + telephony + scheduled-reports + transcribing-reaper schedulers, handles AssemblyAI webhook endpoint |
| **Auth & Sessions** | `server/auth.ts`, `server/routes/auth.ts` | Passport.js local strategy, session management (PostgreSQL or memorystore), password hashing/complexity, account lockout, session fingerprinting, MFA two-step flow. `deserializeUser` validates UUID format before DB lookup — non-UUID IDs (from AUTH_USERS) skip DB, go to env-var fallback. F8 boot guard: `loadUsersFromEnv` emits `logger.error` when `AUTH_USERS` was set but every entry was rejected (weak password / malformed) — closes the silent zero-users deploy footgun. |
| **Call Routes** | `server/routes/calls.ts`, `server/routes/calls-tags.ts` | Call CRUD, audio streaming, transcript/sentiment/analysis retrieval, tagging, annotations |
| **Pipeline** | `server/routes/pipeline.ts` | Core audio processing: transcription → quality gates → RAG fetch → injection detection → AI analysis → score calibration → storage → coaching/badges/webhooks |
| **Route Utilities** | `server/routes/utils.ts` | Shared helpers: `sendError`, `sendValidationError`, `validateParams`, `validateIdParam`, `safeFloat`, `safeJsonParse`, `clampInt`, `parseDate`, `TaskQueue` (with `QueueFullError`/`TaskTimeoutError`, `maxQueueSize=1000`, `taskTimeoutMs=10min` bounds), `computeConfidenceScore`, `autoAssignEmployee`, `cleanupFile`, `escapeCsvValue`, `filterCallsByDateRange`, `countFrequency`, `calculateSentimentBreakdown`, `calculateAvgScore`, `estimateBedrockCost`, `estimateAssemblyAICost`, `estimateEmbeddingCost`. **Note:** `requireRole` is exported from `server/auth.ts`; `asyncHandler` is exported from `server/middleware/error-handler.ts` (not utils.ts). |
| **Admin Routes** | `server/routes/admin.ts`, `admin-security.ts`, `admin-operations.ts`, `admin-content.ts` | Admin facade delegating to security (WAF, incidents, vulns), operations (queue, batch, calibration, telephony), and content (templates, template back-testing, A/B tests, A/B aggregate + promotion flow, webhooks, usage). |
| **Employee Routes** | `server/routes/employees.ts` | Employee CRUD, bulk CSV import, server-defined team / sub-team taxonomy (`GET /api/employees/teams`) |
| **Public Config** | `server/routes/config.ts` | `GET /api/config` — public, no auth. Returns `companyName` + scoring tier thresholds for the login page and tenant-tunable UI. Consumed by `client/src/hooks/use-config.ts`. |
| **Dashboard & Metrics** | `server/routes/dashboard.ts` | Dashboard metrics, sentiment distribution, top performers, flagged calls, week-over-week changes narrative (`/api/dashboard/weekly-changes`) for the "This Week in Review" widget. |
| **Analytics** | `server/routes/analytics.ts` | Team analytics, trends, speech metrics, call clustering, CSV export, heatmaps, agent comparison, employee health pulse (`GET /api/analytics/health-pulse/:employeeId` — current vs prior N-day window, per-sub-score deltas, trend classification) |
| **Reports** | `server/routes/reports.ts` | Search, agent profiles, filtered reports, AI-generated agent summaries, client-export audit beacon (`POST /api/reports/export-beacon` — HIPAA), scoring-corrections self-view (`GET /api/scoring-corrections/mine`) |
| **Coaching** | `server/routes/coaching.ts` | Coaching session CRUD, action item toggling, webhook triggers |
| **Users** | `server/routes/users.ts` | User management (admin CRUD, password reset/change, MFA) |
| **Snapshots** | `server/routes/snapshots.ts` | Performance snapshot generation/retrieval (employee/team/dept/company). Generation helpers (`generateEmployeeSnapshot`/`generateTeamSnapshot`/`generateDepartmentSnapshot`/`generateCompanySnapshot`/`generateBatchSnapshots`) are module-level exports — callable from the job worker. `POST /api/snapshots/batch` enqueues a `batch_snapshots` job and returns `202 { jobId, statusUrl }` when DATABASE_URL is set; sync fallback otherwise (A8). Hosts `GET /api/admin/jobs/:id` for generic job polling. |
| **Gamification** | `server/routes/gamification.ts` | Leaderboard, badges, points, stats |
| **Insights** | `server/routes/insights.ts` | Aggregate topic frequency, complaint patterns, escalation trends. Defaults to a rolling 90-day window via `?days` (max 365); previously was an unbounded full-table scan (A4). |
| **Storage** | `server/storage.ts`, `server/storage-postgres.ts` | `IStorage` interface (~40 methods, A7 added `getCallsByStatus(status)` and `getCallsSince(date)` — indexed lookups that replaced `getAllCalls` scans in batch orphan recovery and auto-calibration), three backends: PostgresStorage (RDS), CloudStorage (S3-only legacy), MemStorage (in-memory dev fallback). New in A21/A20: `findCallByContentHash`, `getEmployeesPaginated`. `atomicAssignEmployee` contract documented for all three backends (A44). Batch 1 (A6/F14): `setCallEmployee` added for explicit reassign/unassign; `updateCall` now throws if `employeeId` is in the updates payload. PostgresStorage `updateCall` uses a dynamic SET clause keyed by COLUMN_MAP — adding a new persisted column requires both a schema migration and a COLUMN_MAP entry. A10: `findCallByExternalId(externalId)` added to all backends, backed by `calls.external_id` + unique partial index for upstream-source dedupe (e.g. 8x8 recording ids). Engagement & Reporting cycle: `countCompletedCallsByEmployee`, `getRecentCallsForBadgeEval`, `getLeaderboardData`, `getCallsSinceWithDetails` added — these are the preferred indexed-lookup primitives over `getCallsWithDetails()` for hot paths (gamification, coaching, insights, scheduled reports, analytics heatmap fallback). F03: `getCallAnalysesBulk(callIds)` added — bulk analysis fetch in single SQL query (chunked IN clause, 500 per chunk), used by auto-calibration to eliminate N+1 queries. F35: `getFilteredReportMetrics(filters)` added — SQL-level aggregation for /api/reports/filtered (4 parallel queries: summary, performers, trends, sub-scores); replaces loading all calls into memory. `getInsightsData(since)` added — lightweight call data (no transcript text/words) for /api/insights; replaces getCallsSinceWithDetails which loaded full CallWithDetails. |
| **Database** | `server/db/pool.ts`, `server/db/schema.sql` | PostgreSQL connection pool (singleton), auto-schema initialization, incremental migrations, SSL enforcement. `mfa_secrets.recovery_codes` JSONB column stores an array of `{ hash, used, usedAt? }` records (idempotent `ADD COLUMN IF NOT EXISTS ... DEFAULT '[]'` migration). |
| **AssemblyAI** | `server/services/assemblyai.ts` | Audio transcription (webhook + polling modes), speaker-labeled transcript building, utterance metrics, transcript data normalization |
| **Bedrock AI** | `server/services/bedrock.ts`, `server/services/ai-provider.ts`, `server/services/ai-factory.ts`, `server/services/active-model.ts` | AWS Bedrock Converse API (raw SigV4, no SDK), prompt building, JSON response parsing, `aiProvider` singleton factory. Exports `BedrockClientError` class (4xx marker — F-17) so the circuit breaker doesn't trip on client-side errors. Both `generateText` AND `analyzeCallTranscript` now throw it on 4xx-except-429 (previously only `generateText` did, which was the F1 brown-out gap). `BedrockProvider.setModel()` allows runtime model swap for A/B test promotion. `active-model.ts` persists the promoted model to S3 (`config/active-model.json`) and rehydrates it on startup via `loadActiveModelOverride()` (fire-and-forget in `server/index.ts`). |
| **Batch Inference** | `server/services/bedrock-batch.ts`, `server/services/batch-scheduler.ts` | Deferred AI analysis via JSONL to S3, periodic job submission/polling/recovery. `bedrock-batch.ts` uses `sigv4.ts` directly for S3 operations, resolves AWS creds lazily via `getAwsCredentials()` (env→IMDS), validates `BEDROCK_BATCH_ROLE_ARN`, paginates `s3List` via continuation token (50-page safety cap), and (F-18) wraps `createJob` + `getJobStatus` in the shared `bedrockCircuitBreaker` from `bedrock.ts` so an outage detected on either path protects both. `readBatchOutput` is intentionally not wrapped (S3, not Bedrock). `batch-scheduler.ts:persistBatchJobTracking()` retries the post-createJob tracking write 3× (1s/2s/4s backoff) with a `batch-inference/orphaned-submissions/${jobId}.json` fallback on persistent failure, and `promoteOrphanedSubmissions()` runs at the top of every batch cycle to self-heal orphans. All tracking-write failures log at `error` level with the jobId + jobArn recovery keys. `processBatchResults` skips `autoAssignEmployee` when `existingCall.synthetic === true` (INV-35 defense-in-depth — synthetic calls don't normally enter batch because simulated-call-storage hard-codes `processingMode:"immediate"`, but the gate prevents future leak vectors). |
| **Transcribing Orphan Reaper** | `server/services/transcribing-reaper.ts` | Periodic scan (15-min interval, 30-min threshold) for calls stuck in `status:"transcribing"`. Marks them `failed` with a "transcription never completed" label. Symmetric with the batch-inference orphan reaper but runs regardless of batch mode — handles the server-restart-mid-transcribe failure where the in-memory `waitForTranscript` promise is lost. Wired into startup (`routes.ts:startTranscribingReaper`) and graceful shutdown (`index.ts:stopTranscribingReaper`). Both timers `.unref()`'d per INV-30. |
| **Scoring** | `server/services/scoring-calibration.ts`, `server/services/auto-calibration.ts`, `server/services/scoring-feedback.ts` | Score normalization, periodic distribution analysis, manager correction capture for future prompt injection. Correction `reason` text is passed through `sanitizeReasonForPrompt()` at capture AND render time and wrapped in `<<<UNTRUSTED_MANAGER_NOTES>>>` delimiters in `buildCorrectionContext()` — a prompt-injection defense that must be preserved by future edits. Exports `getRecentCorrectionsByUser` / `getUserCorrectionStats` for the self-service corrections dashboard widget. |
| **AWS Infrastructure** | `server/services/s3.ts`, `server/services/sigv4.ts`, `server/services/aws-credentials.ts` | Custom S3 REST client (single consumer: `storage.ts`), SigV4 signing, credential resolution (env vars + IMDS with caching) |
| **RAG** | `server/services/rag-client.ts` | Knowledge base integration with LFU cache, confidence filtering, graceful fallback |
| **Security** | `server/services/audit-log.ts`, `server/services/security-monitor.ts`, `server/services/vulnerability-scanner.ts`, `server/services/incident-response.ts` | HIPAA audit logging (dual-write, HMAC chain, persistent integrity head), brute-force/credential stuffing detection (wired to client IP via `passReqToCallback`), automated vuln scanning (history retains hollow entries past cap, summary kept), incident lifecycle management (DB-first persist; randomUUID IDs; throws on persist failure) |
| **MFA** | `server/services/totp.ts` | RFC 6238 TOTP with replay protection (used-token cache, 2-min auto-cleanup). Recovery codes: 10-char alphanumeric, scrypt-hashed, single-use, generated at enable/regenerate; exports `generateRecoveryCodes`, `consumeRecoveryCode`, `countRemainingRecoveryCodes`. `requireMFASetup` (in `server/auth.ts`) is gated on `isMFARequired()` (REQUIRE_MFA env var) — no-op when unset. When active, mounted blanket on `/api/admin/*` and per-route on all manager/admin-gated mutations (calls, employees, users, coaching, exports, snapshots) |
| **PHI Protection** | `server/services/phi-redactor.ts`, `shared/phi-patterns.ts`, `server/services/prompt-guard.ts` | 14-pattern PHI redaction — single source of truth in `shared/phi-patterns.ts`, imported by `phi-redactor.ts` (server audit logs, logger). `redactPhi()` adds count tracking. 16-pattern prompt injection detection + output anomaly scanning (`prompt-guard.ts`) |
| **SSRF Protection** | `server/services/url-validator.ts` | URL validator blocking private IPs, metadata endpoints, DNS resolution to private ranges |
| **Resilience** | `server/services/resilience.ts` | Circuit breaker (5 failures → 30s open → half-open test) wrapping Bedrock calls. Consumed by `bedrock.ts` (on-demand) and `bedrock-batch.ts` (batch — F-18) which share the same breaker instance — an outage detected on either path protects both. `execute()` takes an optional `isFailure(err)` predicate; Bedrock uses it to keep `BedrockClientError` (4xx, except 429) from tripping the breaker (F-17/F-18) — only 5xx + 429 count toward the open threshold. |
| **Job Queue** | `server/services/job-queue.ts` | PostgreSQL-backed durable queue with `FOR UPDATE SKIP LOCKED`, 30s worker heartbeat, 2min stale reap, attempts-on-failJob contract (A18). `getJob(jobId)` lookup added (A8) for polling-based async job patterns. Worker handlers in `routes.ts`: `process_audio` (audio pipeline) and `batch_snapshots` (snapshot generation). |
| **WebSocket** | `server/services/websocket.ts` | Authenticated WebSocket server broadcasting real-time call processing status |
| **Webhooks** | `server/services/webhooks.ts` | HMAC-signed HTTP POST notifications on call events with retry logic and SSRF validation |
| **Coaching Alerts** | `server/services/coaching-alerts.ts` | Auto-creates coaching sessions for low/high-score calls, detects recurring weaknesses |
| **Gamification Service** | `server/services/gamification.ts` | Badge evaluation (11 types — A13 removed `most_improved`), points/streak computation, leaderboard queries with 60s in-memory cache (`clearLeaderboardCache()` test seam). Cache is NOT invalidated by badge inserts. |
| **Snapshots Service** | `server/services/performance-snapshots.ts` | AI-generated narrative + numerical performance snapshots at multiple levels. In-memory cache bounded to 200 (FIFO) (A6). `saveSnapshot` and `resetSnapshotContext` rethrow real DB errors — was silent before (A6). `aggregateMetrics` includes `lowConfidenceCallCount`/`promptInjectionCallCount`/`outputAnomalyCallCount` (A11) — historical snapshots persisted before A11 do not have these keys, so consumers must default to 0. |
| **Best Practice Ingest** | `server/services/best-practice-ingest.ts` | Auto-ingests exceptional calls (score ≥9.0) to knowledge base |
| **Call Clustering** | `server/services/call-clustering.ts` | Groups calls by topic similarity using TF-IDF cosine similarity |
| **Medical Synonyms** | `server/services/medical-synonyms.ts` | Expands medical abbreviations in search queries |
| **Telephony** | `server/services/telephony-8x8.ts` | 8x8 auto-ingestion framework (stub, pending API access) |
| **Scheduled Reports** | `server/services/scheduled-reports.ts` | Weekly/monthly performance summary generation persisted to `scheduled_reports` table with `UNIQUE(type, period_start)` for idempotent re-runs (A3). On startup the scheduler hydrates the in-memory cache from DB and runs catch-up across a 12-period lookback for both weekly Mondays and monthly 1st-of-months, generating any missing reports in chronological order. `getReport(id)` is async (DB lookup on cache miss). `getReports()` returns a defensive copy. Cache bounded to 50 entries. |
| **Observability** | `server/services/logger.ts`, `server/services/correlation-id.ts`, `server/services/tracing.ts`, `server/services/trace-span.ts`, `server/services/sentry.ts` | Structured JSON logging, per-request correlation IDs, OpenTelemetry tracing. Error tracking via AWS CloudWatch Logs + Alarms. `sentry.ts` exports no-op stubs (`captureException`/`captureMessage`) — Sentry fully removed but ~30 callsites still import the stubs. |
| **Middleware** | `server/middleware/waf.ts`, `server/middleware/rate-limit.ts`, `server/middleware/error-handler.ts` | WAF split into `wafPreBody`/`wafPostBody` passes (pre runs before body parser, post after — no-ops on multipart); per-user rate limiting with LRU-bounded maps (10k cap); `AppError` + `globalErrorHandler` with transitional `{message, error:{code,message,detail?}}` response shape and prod 5xx sanitization. |
| **Shared Schema** | `shared/schema.ts` | Zod schemas for all entities, shared between client and server |
| **Constants** | `server/constants.ts` | Centralized scoring thresholds (env-configurable) |
| **Frontend Entry** | `client/src/main.tsx`, `client/src/App.tsx` | React SPA root: auth gate, 25 lazy-loaded pages, WebSocket connection, idle timeout, keyboard shortcuts |
| **Frontend Lib** | `client/src/lib/` | TanStack Query setup (`queryClient.ts` — exports `apiRequest`, `getCsrfToken`, `SessionExpiredError` with optional `code`, new `ApiError` class, `LOGIN_GRACE_MS`), i18n (`i18n.ts` with `TRANSLATIONS` export + dev-mode missing-key warning), appearance/theme, error capture stubs (`sentry.ts` — no-op stubs, Sentry removed), saved filters (`saved-filters.ts` — `SavedFilter` schema covers all 8 search filters: status, sentiment, employee, searchQuery, dateFrom, dateTo, minScore, maxScore), display utils, constants (scoring tier thresholds + `LOGIN_GRACE_MS` mirror of server config), `safe-storage.ts` (quota-tolerant localStorage wrapper), `transcript-search.ts` (pure helpers for multi-hit search highlight). The design-token source of truth is `client/src/index.css` (OKLCH palette, font families, radius, utility classes). Fonts loaded via `client/index.html` Google Fonts link. `tailwind.config.ts` consumes the CSS variables and exposes `font-display` / `font-sans` / `font-mono` utility aliases. Claude Design handoff bundle lives at `docs/design-bundle/` for subsequent page redesigns. |
| **Frontend Hooks** | `client/src/hooks/` | `useWebSocket` (A13 — mount-once-per-mount via refs), `useIdleTimeout` (A16 — fail-closed with server logout + redirect; F06 added POST /api/auth/logout before hard-redirect in catch path; F-03 added document `visibilitychange` listener that resets timers on tab-return — tab-hidden does NOT reset, so away-from-machine still times out), `useBeforeUnload`, `useConfig` (A11 — `/api/config` fetch with `FALLBACK_CONFIG`), `useToast` |
| **Frontend Pages** | `client/src/pages/` | 28+ page components (dashboard, upload, transcripts, reports, coaching, my-coaching, admin [Users CRUD + Access Requests + Role Definitions tabs], system-health, batch-status [admin batch inference dashboard, auto-refresh 30s], leaderboard, etc.) |
| **Frontend Components** | `client/src/components/` | Layout (sidebar with MFA setup trigger), UI (shadcn/ui), MFA setup dialog (`mfa-setup-dialog.tsx`), backgrounds, error boundary, file upload, and `analytics/chart-primitives.ts` (installment 9 — shared Recharts typography/chrome + score-tier color, consumed by all warm-paper analytics pages). |

### Data Flow Paths

**Path 1: Audio Upload → Analysis Completion**
```
POST /api/calls/upload [routes/calls.ts:133]
  → requireAuth middleware
  → multer parses file → sanitize filename, validate category/language/processingMode
  → Duplicate detection: SHA-256 content hash compared against existing calls
    (rejects with 409 if already uploaded)
  → storage.createCall() with status: "processing"
  → storage.uploadAudio() — archive to S3
  → If jobQueue (PostgreSQL) → jobQueue.enqueue("process_audio", payload)
    Else → audioProcessingQueue.add() [in-memory TaskQueue]
  → Return 201 with call record (pipeline runs async)

Job worker [routes.ts:180] or in-memory TaskQueue [pipeline.ts:21]
  → Reads audio from S3 (job queue path) or uses buffer (in-memory path)
  → Calls processAudioFile() [pipeline.ts:57]:
    1. Get audio URL (presigned S3 or upload to AssemblyAI) [assemblyai.ts]
    2. Archive audio to S3 (skipped if already archived)
    3. Build word boost list from employee names + COMPANY_NAME
    4. Submit transcription [assemblyai.ts:transcribeAudio]
    5. Wait for transcript (webhook resolve OR polling) [assemblyai.ts:waitForTranscript]
    6. Quality gates: empty transcript (<10 chars) OR low confidence (<0.6) → early exit
    7. Build speaker-labeled transcript [assemblyai.ts:buildSpeakerLabeledTranscript]
    8. Compute utterance metrics [assemblyai.ts:computeUtteranceMetrics]
    9. [Parallel] RAG context fetch [rag-client.ts] + injection detection [prompt-guard.ts]
    10. Build analysis prompt (with RAG, custom template, corrections) [ai-provider.ts]
    11. If batch mode → save to S3 pending/, store partial analysis,
        set status "awaiting_analysis", track usage, return early
    12. If on-demand → call Bedrock (via circuit breaker) [bedrock.ts → resilience.ts]
        - Cost optimization: Haiku for short routine calls (≤120s, no template, <3K tokens)
    13. Process results: normalize, calibrate sub-scores [scoring-calibration.ts]
    14. Compute confidence score [utils.ts:computeConfidenceScore]
    15. Identify agent speaker label from detected name
    16. Store utterance metrics + RAG sources in confidenceFactors
    17. Defer auto-categorize decision (if AI returned category and none provided at upload) — applied in the final updateCall in step 22, not mid-pipeline (A15)
    18. Apply flags: low_confidence, prompt_injection_detected, output_anomaly
    19. Store transcript, sentiment, analysis [storage]
    20. [Fire-and-forget] generateCallEmbedding()
    21. Auto-assign employee by detected name [utils.ts:autoAssignEmployee] (awaited)
    22. storage.updateCall() → status: "completed"
    23. [Fire-and-forget] Coaching alerts [coaching-alerts.ts] — analysis fields (`feedback`/`subScores`/`flags`) passed through; no re-fetch from storage (A12)
    24. [Fire-and-forget] Badge evaluation [gamification.ts] — uses indexed `countCompletedCallsByEmployee` + `getRecentCallsForBadgeEval(25)` (A4)
    25. [Fire-and-forget] Best practice ingestion if score ≥9.0 [best-practice-ingest.ts]
    26. [Fire-and-forget] Webhook triggers: call.completed (+ score.low ≤4, score.exceptional ≥9)
    27. Track usage record [storage.createUsageRecord]
    28. WebSocket broadcast "completed" → frontend [websocket.ts:broadcastCallUpdate]
    29. finally: cleanupFile(filePath)

  On error: mark call "failed", broadcast "failed", trigger call.failed webhook,
  cleanupFile in finally block.
```

**Path 2: AssemblyAI Webhook → Transcript Stored**
```
POST /api/webhooks/assemblyai [routes.ts]
  → Timing-safe secret verification (production requires ASSEMBLYAI_WEBHOOK_SECRET)
  → handleAssemblyAIWebhook(transcript_id, data) [assemblyai.ts]
  → Resolves pending promise in assemblyAIService.waitForTranscript()
  → Pipeline continues from step 4 in Path 1 above
  → If transcript_id not in pending map → acknowledged but ignored (stale delivery)
```

**Path 3: Authentication**
```
POST /api/auth/login [routes/auth.ts]
  → Rate limit (5/15min/IP) → WAF check → CSRF exempt
  → If mfaToken + totpCode → Step 2 (MFA verification):
    → Lookup pending token; if missing or expired →
      audit mfa_session_expired, return 401 { code: "mfa_session_expired" }
    → If pending.attempts >= MFA_MAX_ATTEMPTS (5) →
      delete token, audit mfa_verification_locked, return 401 { code: "mfa_session_expired" }
    → Branch by code format:
      - 6-digit numeric → getMFASecret → verifyTOTP (timing-safe, replay-protected)
      - 10-char alphanumeric → consumeRecoveryCode (scrypt compare, timing-safe,
        does NOT short-circuit; marks record used: true, single-use enforced)
    → If verification fails → pending.attempts++, audit mfa_verification_failed
      (with attempt N/5), return 401
    → If verified → delete pending token,
      audit mfa_verification_succeeded OR mfa_recovery_code_used,
      req.login(user, { keepSessionInfo: true }) → bindSessionFingerprint
  → Else Step 1 (password):
    → passport.authenticate("local") → account lockout check
    → DB user lookup [storage] or AUTH_USERS env var fallback
    → Password verify (scrypt + timingSafeEqual)
    → If MFA enabled → issue mfaToken (5-min expiry, attempts: 0),
      audit mfa_challenge_issued, return { mfaRequired: true, mfaToken }
    → If MFA required but not set up → login + { mfaSetupRequired: true }
    → Standard login → req.login() + bindSessionFingerprint()
  → Session stored in PostgreSQL (connect-pg-simple) or memorystore

POST /api/auth/logout [routes/auth.ts]
  → req.logout() → session.destroy()
  → audit logout (extracts username BEFORE logout so it's still available)

Every subsequent request:
  → requireAuth → session validation → deserializeUser:
    → UUID-format ID → DB lookup (transient errors propagate as 500)
    → Non-UUID ID → skip DB, env-var user fallback only
  → fingerprint check (UA + accept-language hash)
  → Mismatch → session destroyed
  → requireRole(level) for role-gated routes
```

### External Dependencies

| Service | Purpose | Integration File |
|---------|---------|-----------------|
| **AssemblyAI** | Audio transcription (speech-to-text, speaker detection, sentiment) | `server/services/assemblyai.ts` — REST API |
| **AWS Bedrock** (Claude Sonnet/Haiku) | AI call analysis via Converse API | `server/services/bedrock.ts` — raw SigV4 signed REST |
| **AWS S3** | Audio blob storage, analysis JSON, batch inference, calibration config | `server/services/s3.ts` — raw SigV4 signed REST |
| **AWS RDS PostgreSQL** | Metadata, sessions, job queue, audit log, users, employees | `server/db/pool.ts` — `pg` driver |
| **AWS EC2 IMDS** | Instance profile credential resolution | `server/services/aws-credentials.ts` |
| **AWS CloudWatch Logs** | Error tracking and alerting (replaces Sentry) | pm2 stdout → CloudWatch agent → metric filters + alarms |
| **RAG Knowledge Base** (ums-knowledge-reference) | Company-specific context for AI analysis | `server/services/rag-client.ts` — REST with X-API-Key |
| **8x8 Telephony** | Call recording auto-ingestion (stub) | `server/services/telephony-8x8.ts` |
| **Redis** (optional) | Distributed job queue | (not currently integrated — placeholder for future BullMQ wiring) |
| **OpenTelemetry Collector** (optional) | Distributed tracing | `server/services/tracing.ts` |
| **Let's Encrypt** (via Caddy) | TLS certificates | `deploy/ec2/Caddyfile` |

### Auth & Security Surface

**Where auth is enforced:**
- `server/auth.ts` → `requireAuth` middleware on all non-public routes (imported by 15 route files)
- `server/auth.ts` → `requireRole(level)` for role-gated endpoints (imported by 12 route files)
- `server/index.ts` middleware stack (in order): X-Forwarded-For validation (strips spoofed IPs), correlation ID injection, HTTPS redirect (production), CORS (same-origin), WAF (SQLi/XSS/path traversal/IP blocklist), security headers (CSP, HSTS, X-Frame-Options, etc.), audit logging, CSRF double-submit cookie, CSRF Content-Type/X-Requested-With check, per-route rate limiting
- `server/routes.ts` → AssemblyAI webhook uses timing-safe secret verification (not session auth)

**Intentional auth bypass points:**
- `GET /api/health` — public health check
- `POST /api/auth/login` — public (rate-limited, WAF-protected)
- `POST /api/auth/logout` — public
- `GET /api/auth/me` — session check (returns 401 if not authenticated)
- `POST /api/access-requests` — public submission
- `POST /api/webhooks/assemblyai` — webhook-secret-verified

**MFA enforcement scope (when `REQUIRE_MFA=true`):**
`requireMFASetup` is applied at two levels: (1) blanket on `/api/admin/*` via `router.use` in `routes.ts`, and (2) per-route on all manager/admin-gated mutations outside `/api/admin/*` — calls (assign, delete, edit analysis, bulk reanalyze), employees (create, update, CSV import), users (all CRUD + password reset), coaching (list, create, update), exports (calls, team analytics, compare), snapshots (generate, batch, reset), and `/api/admin/jobs/:id`. Read-only routes (dashboard, transcripts, search, analytics queries) remain accessible during the MFA setup window so the app can render.

**Where PHI is touched:**
- Audio files in S3 (call recordings)
- Transcripts in PostgreSQL/S3 (spoken content)
- Bedrock prompts (contain transcript text)
- Audit log stdout entries (PHI-redacted via `phi-redactor.ts`)
- RAG queries use category templates, NOT raw transcript (avoids PHI leakage)
- WebSocket broadcasts contain status only, not PHI content

### Inter-Module Dependency Map (Verified)

**Highest fan-out modules (most consumers):**

| Module | Consumers | Notes |
|--------|-----------|-------|
| `server/routes/utils.ts` | 16 files | All route files + `performance-snapshots.ts`, `batch-scheduler.ts` |
| `server/storage.ts` | 27 files | 15 route files + `index.ts`, `routes.ts`, `auth.ts`, `storage-postgres.ts` (type import), and 8 services: `gamification.ts`, `coaching-alerts.ts`, `batch-scheduler.ts`, `scheduled-reports.ts`, `telephony-8x8.ts`, `scoring-feedback.ts`, `auto-calibration.ts`, `call-clustering.ts`. **Note:** `webhooks.ts` does NOT directly import `storage` — it receives an S3 client via `initWebhooks()` callback wired in `server/index.ts` startup (after `initializeDatabase()`). |
| `server/auth.ts` | 16 files | All 15 auth-using route files + `websocket.ts` (imports `sessionMiddleware`) |
| `server/services/audit-log.ts` | 13 files | Security services, middleware/waf, most route files |
| `shared/schema.ts` | 15+ files | Route files, storage, services, client |

**Key verified dependency chains:**
- `shared/schema.ts` → consumed by route files, `storage.ts`, `storage-postgres.ts`, services — VERIFIED
- `server/storage.ts` → consumed by `pipeline.ts` + 14 other route files + 8 services (see table above) — VERIFIED
- `server/routes/pipeline.ts` → exports `processAudioFile`, `shouldUseBatchMode`, `audioProcessingQueue`; all three consumed by `routes.ts` only (`processAudioFile` passed to `registerCallRoutes`, `startTelephonyScheduler`, and called in job worker) — VERIFIED
- `server/services/ai-factory.ts` → `aiProvider` consumed by `pipeline.ts`, `reports.ts`, `snapshots.ts`, `coaching-alerts.ts` — VERIFIED
- `server/services/assemblyai.ts` → consumed by `pipeline.ts`, `routes.ts`, `analytics.ts`, `admin-content.ts`, `batch-scheduler.ts` — VERIFIED
- `server/services/rag-client.ts` → `fetchRagContext` / `isRagEnabled` consumed by `pipeline.ts`, `coaching-alerts.ts`, `scoring-feedback.ts`, `best-practice-ingest.ts` — VERIFIED
- `server/services/s3.ts` → `S3Client` consumed by `storage.ts` ONLY. `bedrock-batch.ts` uses `sigv4.ts` directly; `webhooks.ts` receives an S3 client via `initWebhooks()` callback wired from `server/index.ts` startup — VERIFIED
- `server/services/bedrock.ts` → `bedrockCircuitBreaker`, `isCircuitFailure`, `BedrockClientError` all exported and consumed by `bedrock-batch.ts` (F-18) so the on-demand and batch paths share one breaker instance — VERIFIED
- `server/services/resilience.ts` → circuit breaker consumed by `bedrock.ts` ONLY — VERIFIED
- `server/services/audit-log.ts` → exports `logPhiAccess`, `flushAuditQueue`, `auditContext` (used by `routes/auth.ts` and other route files for extracting audit context), `AuditEntry`, `getDroppedAuditEntryCount`, `getPendingAuditEntryCount` — VERIFIED
- `server/routes.ts` → dynamically imports `./routes/snapshots` to call `generateBatchSnapshots` from the `batch_snapshots` job worker handler — creates a route-coordinator → route-module dependency edge that didn't exist before A8 — VERIFIED
- `client/src/lib/queryClient.ts` → consumed by every page. New consumers from the A10 batch: `client/src/pages/ab-testing.tsx` and `client/src/components/upload/file-upload.tsx` both now use shared `getCsrfToken` instead of inline cookie regex parsers.
- `client/src/hooks/use-config.ts` → consumed by `client/src/pages/auth.tsx` and `client/src/components/layout/sidebar.tsx` for `companyName` display (A27). Wraps `useQuery(["/api/config"], { staleTime: Infinity })` with `FALLBACK_CONFIG` for loading / error states.
- `shared/phi-patterns.ts` → consumed by `server/services/phi-redactor.ts` (single source of truth for all 14 PHI regex patterns). No longer consumed by `client/src/lib/sentry.ts` (Sentry removed).

### Complexity & Risk Rankings

**Highest-complexity subsystems (most likely to contain hidden issues):**
1. **Audio Processing Pipeline** (`server/routes/pipeline.ts`) — 600+ lines, 10+ async steps, dual-mode, 6 fire-and-forget side effects, quality gates, cost optimization branching
2. **Storage Abstraction** (`server/storage.ts` + `server/storage-postgres.ts`) — 43+ method interface, 3 backends, manual SQL with dynamic WHERE clauses, no query builder
3. **AWS SigV4 + Custom S3/Bedrock** (`sigv4.ts`, `s3.ts`, `bedrock.ts`, `aws-credentials.ts`) — Hand-rolled cryptographic signing, credential refresh, IMDS caching
4. **Security Middleware Stack** (`server/index.ts` lines 25–280) — 10+ ordering-sensitive middleware layers, dual CSRF implementations
5. **Auth + Session Management** (`server/auth.ts`) — Passport 0.7 compat patches, dual user source, session fingerprinting, MFA integration

**Highest-risk subsystems (most likely to cause problems if broken):**
1. **AWS SigV4 + S3/Bedrock clients** — Single point of failure for all AWS services, no SDK fallback
2. **Audio Processing Pipeline** — Core value proposition; if broken, no new calls processed
3. **Authentication** (`server/auth.ts`) — Breakage means lockout or security bypass
4. **Storage layer** — 15+ route files depend on it; manual SQL for ~30 methods
5. **Route utilities** (`server/routes/utils.ts`) — 16 consumers; bugs cascade everywhere

### Known Discrepancies

- `server/services/rag-hybrid.ts` was deleted in A8 (was dead code; never imported by any production file)
- `server/services/durable-queue.ts` was deleted in Batch 2 (A40) — any lingering references in older docs should be treated as stale
- `server/services/telephony-8x8.ts` is described as an integration but is a stub pending API access
- `server/services/scheduled-reports.ts` is dynamically imported by `routes.ts` for the scheduler init; the admin routes (`/api/admin/reports`, `/api/admin/reports/:id`, `/api/admin/reports/generate`) ARE in the API table as of A16.
- `@replit/vite-plugin-*` packages remain in devDependencies but are unused in `vite.config.ts`
- Improvement roadmap lists "Structured observability" and "correlation IDs" as TODO but both are implemented

## Operator State Checklist

State that must exist for the app to function correctly but is not always validated by automated startup checks. Run through this checklist before deploying to a new environment.

### Hard-fail at boot (validated)
These cause the server to refuse to start if missing in production. No silent degradation.

- [ ] `SESSION_SECRET` — `server/auth.ts:189` (boot-fails in production)
- [ ] `AUDIT_HMAC_SECRET` — `server/services/audit-log.ts:55` (boot-fails in production, HIPAA §164.312(b))
- [ ] `S3_BUCKET` when `DATABASE_URL` is set in production — `server/storage.ts:createStorage()` (boot-fails)
- [ ] `audit_log_integrity` table reachable at startup — `server/services/audit-log.ts:loadAuditIntegrityChain()` retries 3x then throws (F01). DB must be responsive within ~7s of startup or server refuses to start. HIPAA §164.312(b).

### Soft-fail at boot (warning only — silent degradation)
These log a warning but allow the server to start. The app appears healthy but has broken or degraded functionality.

- [ ] `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or EC2 instance profile) — needed for Bedrock + S3. Without these, audio uploads queue to "processing" status and never complete. **HIGH risk** — app appears healthy, all uploads silently broken.
- [ ] `ASSEMBLYAI_WEBHOOK_SECRET` if `APP_BASE_URL` is set in production — webhooks rejected at runtime (transcription falls back to polling). **MEDIUM risk** — slower turnaround but no functional break.
- [ ] `RAG_SERVICE_URL` and `RAG_API_KEY` if `RAG_ENABLED=true` — RAG silently disabled, AI uses generic prompts. **MEDIUM risk** — analyses lose company-specific grounding.
- [ ] `AUTH_USERS` env var OR a row in the `users` table seeded manually — without either, no one can log in. **HIGH risk** — fresh deploy is unusable. After deploy, grep pm2 logs for `auth: AUTH_USERS was set but ALL entries were rejected` to confirm at least one ENV-VAR user loaded (F8).
- [ ] `REQUIRE_MFA=true` without enrolled admins — `server/auth.ts:551` (`requireMFASetup` middleware). ALL `/api/admin/*` routes return 403 for admin/manager users who haven't enrolled MFA. Health check passes, app appears healthy. **HIGH risk** — admin panel completely inaccessible. Recovery: enroll via `/api/auth/mfa/setup` + `/api/auth/mfa/enable` (NOT blocked by `requireMFASetup`).
- [ ] `REQUIRE_MFA=true` with AUTH_USERS admin/manager — `server/auth.ts:365` (F-06). ENV-VAR admin/manager users are now **blocked at login** because they cannot enroll in MFA (no DB row for TOTP secret). **Recovery:** run `npm run seed-admin -- --username=<u> --password=<p> --name=<n>` on the deploy target to create a DB admin row directly (uses the same scrypt hasher + complexity validator as the `/api/users` route). Then log in with that DB user; the MFA setup dialog appears automatically on first login. **HIGH risk** — admin access completely blocked if only AUTH_USERS admin exists and REQUIRE_MFA is enabled and `npm run seed-admin` hasn't been run yet.
- [ ] `DISABLE_SECURE_COOKIE` set in production — `server/auth.ts:234`, `server/index.ts:74`. Silently disables HTTPS-only session cookies, enabling session hijacking over HTTP. No startup warning. **MEDIUM risk** — security degradation without visibility.
- [ ] `BEDROCK_MODEL` must be in `BEDROCK_PRICING` if set — `server/index.ts` startup and `server/routes/utils.ts:warnOnUnknownBedrockModel`. Without this, cost tracking silently records $0 for affected calls while AWS still bills. **LOW risk** (warning now fires loudly at boot + once per unknown model at runtime via `logger.warn`); was **HIGH** risk before this fix.
- [ ] **Viewer user accounts must be linkable to an employee row** — `server/auth.ts:getUserEmployeeId()` matches `username→email` then `displayName→name`. If no match, viewers see empty call lists and 403 on agent endpoints. Silent degradation — no startup warning. **MEDIUM risk** — viewer appears authenticated but sees no data. Ensure DB employee records use the same email as the corresponding user's login.
- [ ] `ELEVENLABS_API_KEY` — `server/services/elevenlabs-client.ts` emits a startup warn when unset. The Simulated Calls sidebar nav entry is still visible to admins regardless, but the `/api/admin/simulated-calls/generate` and `/voices` routes return 503 on use. No in-UI "feature unavailable" banner. **MEDIUM risk** — admin clicks a visible feature and sees repeated 503s with no explanation.
- [ ] `ffmpeg-static` binary executable on the deploy target — validated lazily via `isFfmpegAvailable()` in `server/services/audio-stitcher.ts`; `/generate` returns 503 if the check fails. No startup validation. Bundled via the `ffmpeg-static` npm package, so a clean `npm install` on Linux/Mac should work; rare cross-platform or permission issues may surface. **LOW risk** — bundled binary, rarely breaks.

### Manual seed required (no startup check, no migration)
Operator must populate this state outside of any automated path. CI does not catch missing data.

- [ ] **`prompt_templates` table seeded with company-specific rows** — `server/routes/pipeline.ts:261` calls `getPromptTemplateByCategory(callCategory)`. Empty table → fallback to generic default prompt. **MEDIUM risk** — pipeline silently runs against generic rubrics, scores produced are not company-specific. Not validated, not warned about, no admin UI bootstrap.
- [ ] **Pre-existing MFA-enrolled users have 0 recovery codes after ae2f30c deploy** — The `mfa_secrets.recovery_codes` column migration is idempotent (`ADD COLUMN IF NOT EXISTS ... DEFAULT '[]'`), so no manual migration is required. However, users who enrolled in MFA before this deploy will see "0 recovery codes remaining" in the MFA dialog until they click "Regenerate Recovery Codes" to self-serve. Login still works via TOTP; recovery-code verification will silently fail until regeneration. **LOW risk** — voluntary feature gap, not functional break. Suggested mitigation: include a note in release notes directing MFA-enrolled users to regenerate.
- [ ] **`simulated_calls` preset library empty after fresh deploy** — `npm run seed` populates 12 preset scripts (`seed/simulated-call-presets/*.json`) under `createdBy='system'`, idempotent via title match. If the seed step is skipped, admins see an empty Library tab but can still build scripts manually in the Generate tab. **LOW risk** — cosmetic / feature-completeness, not a functional break.

### One-time migration backfills
These are SQL scripts that must be run once during a specific upgrade window. Deploying without them leaves orphaned state.

- [ ] **A18 job heartbeat backfill** (pre-A18 → A18 upgrade only): `UPDATE jobs SET last_heartbeat_at = NOW() WHERE status = 'running' AND last_heartbeat_at IS NULL;` — without this, the reaper's `<` comparison skips NULLs and existing 'running' jobs from old deploys are unreapable. **MEDIUM risk** — stale running jobs accumulate.
- [ ] **A13 most_improved badge cleanup** (Engagement & Reporting Batch 2 deploy): `SELECT count(*) FROM badges WHERE badge_type = 'most_improved'`. If non-zero (almost certainly zero — no evaluator ever existed), decide whether to delete or accept that they render with the raw `badge_type` string and no label/icon. **LOW risk** — cosmetic.
- [x] **A11 PerformanceMetrics historical backfill** — **RESOLVED via mapper defaults**. `rowToSnapshot` in `server/services/performance-snapshots.ts` now defaults `lowConfidenceCallCount`, `promptInjectionCallCount`, and `outputAnomalyCallCount` to 0 when reading pre-A11 snapshots. The JSONB backfill SQL (`UPDATE performance_snapshots SET metrics = jsonb_set(...)`) is no longer required. Historical snapshots will display 0 for these three counts rather than `NaN`; they stay 0 even after future re-reads unless the snapshot is regenerated.
- [ ] **A10 stale snapshot CX backfill** (optional, Engagement & Reporting Batch 2 deploy): A10 fixed the read path that was looking for `customer_experience` (snake_case) instead of `customerExperience` (camelCase) in `aggregateMetrics`. The bug was in the read path so call-level data is correct, but every snapshot persisted before the fix has `metrics.subScores.customerExperience = 0` baked into its JSONB. Regenerate snapshots if accurate historical CX numbers matter. **MEDIUM risk** for users looking at historical performance reviews.

### Pending fixes (security/correctness gaps introduced this cycle)
- [x] **`/api/admin/jobs/:id` MFA bypass** — FIXED: `requireMFASetup` added directly to route handler in `snapshots.ts`. No longer depends on middleware mount ordering in `routes.ts`.

## Simulated Call Generator (admin-only QA tool)

Synthetic call recordings for QA training, agent evaluation, and regression-testing the analysis pipeline. Admin-only, gated by MFA (mounted under `/api/admin/*`). All four build phases complete (foundation + isolation, TTS/ffmpeg backend, API/jobs/seed, frontend UI).

### Isolation guarantee (INV-34 / INV-35)

Synthetic calls live in the `calls` table with `synthetic = TRUE`. Every aggregate query, learning loop, and reporting path excludes them. The following are covered end-to-end:

- **Storage queries** (both Postgres and MemStorage): `getAllCalls`, `getCallsSince`, `getCallsWithDetails`, `getCallsPaginated`, `getCallsSinceWithDetails`, `countCompletedCallsByEmployee`, `getRecentCallsForBadgeEval`, `getLeaderboardData`, `getDashboardMetrics`, `getSentimentDistribution`, `getTopPerformers`, `getFilteredReportMetrics`, `getInsightsData`, `searchCalls`. Intentional exception: `getCallsByStatus` INCLUDES synthetic (orphan recovery needs to reap stalled generate-and-analyze jobs).
- **Route SQL**: `/api/analytics/trends` (company + per-agent), `/api/export/calls` CSV, `/api/export/team-analytics` CSV, `/api/analytics/heatmap`, `/api/calls/by-tag/:tag`.
- **Pipeline side-effects** (in `server/routes/pipeline.ts`): `autoAssignEmployee`, `checkAndCreateCoachingAlert`, `evaluateBadges`, `ingestBestPractice`, `triggerWebhook("call.completed" | "score.low" | "score.exceptional")` — all short-circuited when the call row has `synthetic = TRUE`.
- **Scoring feedback**: PATCH `/api/calls/:id/analysis` does NOT capture a correction when the underlying call is synthetic — prevents synthetic edits from being injected into future real-call prompts as "RECENT SCORING CORRECTIONS".

Regression guard: `tests/synthetic-call-isolation.test.ts` (18 assertions). Adding a new storage query that reads `calls` requires adding a corresponding assertion there.

### Data model

- `calls.synthetic BOOLEAN NOT NULL DEFAULT FALSE` — populated only by the simulated-call pipeline.
- `simulated_calls` table — holds the script + config + generated-audio metadata. When "Send to Analysis" is clicked, a corresponding row is created in `calls` (with `synthetic = TRUE`) and linked back via `simulated_calls.sent_to_analysis_call_id`.
- Migrations in `server/db/pool.ts:runMigrations` are idempotent. The `synthetic` column is backfilled to FALSE on existing rows, then SET NOT NULL.
- Partial index `idx_calls_synthetic_false` keeps the hot-path filter cheap (synthetic rows are a tiny minority).

### Generation pipeline

- `server/services/elevenlabs-client.ts` — raw REST wrapper for the ElevenLabs TTS API. Mirrors the `AssemblyAIService` pattern: config from env, `isAvailable` guard, 429 retry-once with 2s backoff, buffer return + billed character count + latency for each call. `estimateElevenLabsCost()` defaults to $0.0003/char (standard tier), overridable via `ELEVENLABS_COST_PER_CHAR`. Accepts per-call `stability` / `similarityBoost` overrides via `TextToSpeechOptions`.
- `server/services/audio-stitcher.ts` — ffmpeg wrapper using the static binary from the `ffmpeg-static` npm package (no apt install required on the EC2 target). Exposes `withTempDir` (cleanup-guaranteed temp workspace), `generateSilence`, `stitchAndPostProcess` (codec simulation: clean/phone/degraded/poor + background noise overlay: none/office/callcenter/static via `anoisesrc`; pre-mixes `BackchannelOverlay[]` if provided), `overlayClipOnClip` (two-input amix with `adelay` — used for real interrupt overlap and for single-clip overlays), `probeDurationSeconds`, and `isFfmpegAvailable` for feature gating.
- `server/services/call-simulator.ts` — orchestrator. Applies circumstance modifiers at step 0 before turn rendering, then renders each script turn via ElevenLabs (text piped through disfluency injection; voice settings resolved per-turn), stitches with gap timing (Box–Muller gaussian for "natural", fixed when configured), uploads the stitched MP3 to S3 under the `simulated/<id>/` prefix, updates the `simulated_calls` row with `audio_s3_key`, `duration_seconds`, `tts_char_count`, `estimated_cost`, `status='ready'`. Throws on any failure.
- Job type `generate_simulated_call` handled in `server/routes.ts` worker at priority **-10** (yields to real-call `process_audio` at priority 0). Failures set `status='failed'` + error on the row, broadcast the WebSocket event, then re-throw so `JobQueue` applies retry/dead-letter semantics. Retry caps via normal `max_attempts=3`. Reads `uploadedBy` from the job payload so post-generation hooks know the originating admin.

### Realism layers (applied in this order at generation time)

The pipeline layers multiple realism transforms. All are opt-out via config flags; defaults produce the most natural-sounding call.

1. **Circumstance modifiers** (`server/services/circumstance-modifiers.ts`) — rule-based text + structural transforms when `config.circumstances` includes any entry whose `CIRCUMSTANCE_META.ruleBased === true`: `angry` (strips softeners, adds terse prefixes, period→exclamation), `hard_of_hearing` (18% chance prepend "Could you repeat that?" to customer turns), `escalation` (appends 3 turns: customer demand → agent transfer → customer ack). Deterministic with a seeded RNG. Non-rule circumstances (`confused`, `grateful`, `distressed`, `time_pressure`, `non_native_speaker`) are handled by the Bedrock rewriter flow — by the time the simulator runs, the stored script already reflects those.
2. **Disfluency injection** (`server/services/disfluency.ts`) — text-layer "um/uh" filler insertion at per-tier rates (`excellent`=0, `acceptable`=light, `poor`=heavy). Applied to the TTS request only; `simulated_calls.script` is never mutated. Gated by `config.disfluencies` (default true).
3. **Per-turn voice settings** — optional `voiceSettings: { stability, similarityBoost }` on each spoken/interrupt turn. Precedence: `turn.voiceSettings` → `script.defaultVoiceSettings` → ElevenLabs client defaults (0.5, 0.75). Only forwarded keys override defaults, so unset turns keep existing pipeline behavior.
4. **Real interrupt overlap** (via `audio-stitcher.ts:overlayClipOnClip`) — replaces the earlier MVP that concatenated primary+interrupter text into one TTS call. Now renders primary and interrupt with OPPOSITE voices, probes the primary duration, and overlaps the interrupt clip at a random offset in the 65–80% window (min 1s) using ffmpeg `adelay` + `amix` (`duration=longest`). Cost: 2× TTS chars per interrupt turn.
5. **Backchannel overlays** — during eligible primary turns (≥4s, spoken, non-poor-tier), injects 1–2 short "mm-hmm"/"I see" clips from the opposite speaker via the stitcher's premix pass. Gated by `config.backchannels` (default true; auto-off on `poor` tier).

### Bedrock script rewriter (Phase B)

`server/services/script-rewriter.ts` uses `aiProvider.generateText()` to rewrite a base script for one or more circumstances. Validates output via `simulatedCallScriptSchema`, then **force-restores** `voices` from the base and `qualityTier` from the target so the model cannot swap voice IDs or drift the requested tier. Errors surface as `ScriptRewriterError` with typed `.stage` (`unavailable` / `model_error` / `parse_error` / `validation_error`). Rewrite cost: ~$0.003 on Haiku, ~$0.034 on Sonnet per rewrite — trivial next to the ~$1–2 downstream TTS cost. Exposed via `POST /api/admin/simulated-calls/:id/rewrite` which returns a PREVIEW (does not persist); the admin's confirmation fires the existing `/generate` endpoint with the rewritten script. Circumstance count per request is capped at 4 to bound prompt size.

### Send-to-analysis flow

`POST /api/admin/simulated-calls/:id/analyze` creates a `calls` row with `synthetic=TRUE` and `external_id = "sim:<simulated_call_id>"`. The unique partial index on `external_id` dedupes second clicks (returns 409). The route enqueues the existing `process_audio` job; the pipeline reads audio from S3 via the normal `getAudioFiles` / `downloadAudio` path and runs transcription + analysis. All learning side-effects auto-skip via INV-34/INV-35 — the flag is set BEFORE the pipeline reads the call, so `isSynthetic` branches are hit.

The route delegates to `sendSimulatedCallToAnalysis()` in `server/services/simulated-call-storage.ts`, which also powers the **auto-analyze hook**: when `config.analyzeAfterGeneration === true`, the job worker calls the same helper immediately after `runSimulator` succeeds. Auto-hook failures log at warn level but don't retry the generation job — the ready call is still usable via the manual button. `SendToAnalysisError` exposes typed `.code` (`not_found` / `not_ready` / `already_sent` / `no_job_queue`) that the route maps to HTTP statuses.

### Daily generation cap

`SIMULATED_CALL_DAILY_CAP` env var (default 20, max 500). Enforced per-admin via `countSimulatedCallsToday()` before each `/generate` call. Excess requests return 429. Prevents accidental spend spikes — a 5-minute excellent-tier call ≈ 5000 chars ≈ $1.50 on standard ElevenLabs pricing.

### Frontend

`client/src/pages/simulated-calls.tsx` — single-page admin UI with Library + Generate tabs:
- **VoicePicker**: Popover with search input, gender filter chips (all/female/male), inline ▶/⏸ preview button per voice using ElevenLabs `preview_url`. Shared `HTMLAudioElement` so only one preview plays at a time; pauses on popover close and unmount.
- **CircumstancePicker**: togglable chips in the Generate panel, each labeled "Rule" (handled by `circumstance-modifiers.ts`) or "AI" (handled by `script-rewriter.ts`). Selected circumstances surface as orange badges on Library cards.
- **TurnRow**: per-turn `SlidersHorizontal` toggle opens an inline panel with stability + similarityBoost sliders plus "inherit"/"clear" affordances. Button lights solid when custom settings are set. Only shown for spoken + interrupt turns (hold has no TTS to tune).
- **VariationDialog**: "Variation" button on ready Library cards opens a two-step modal (circumstance multi-select + target tier → preview → confirm). Preview calls `/rewrite`; confirm calls `/generate` with the rewritten script, carrying the selected circumstances into the new row's `config.circumstances` so Library badges reflect them.
- **Realism toggles**: Audio Quality panel has checkboxes for `disfluencies`, `backchannels`, and `analyzeAfterGeneration`.
- Library tab polls every 3s while any generation is active, 15s otherwise; on-focus refetch enabled. Inline `<audio>` player streams directly from the authenticated `/audio` route. Status badges (Queued/Generating/Ready/Failed), quality-tier tag, orange circumstance badges, and an Analyzed badge when the call was sent to analysis.
- Generate tab supports form mode (add/remove agent/customer/hold turns, Zod-validated) and JSON paste mode. Live summary shows turn/char count + estimated TTS cost + selected-circumstance count before submit.
- WebSocket event `simulated_call_update` dispatched as `window` event `ws:simulated_call_update` and also triggers `queryClient.invalidateQueries({ queryKey: ["/api/admin/simulated-calls"] })` so status ticks repaint without manual refresh.
- Sidebar nav entry at `/admin/simulated-calls` under the Admin collapsible section (Microphone icon).

### Seed data

12 preset scripts in `seed/simulated-call-presets/` (4 scenarios × poor/acceptable/excellent quality tiers): CPAP order status, Power Wheelchair billing dispute, Oxygen Concentrator malfunction, CGM eligibility. Uses ElevenLabs default voices available on every account (Adam `pNInz6obpgDQGcFmaJgB`, Rachel `21m00Tcm4TlvDq8ikWAM`). `npm run seed` seeds missing presets under `createdBy='system'`; idempotent via title match — existing rows are untouched so operator-deleted presets won't respawn.

### Storage service

`server/services/simulated-call-storage.ts` exposes `createSimulatedCall`, `getSimulatedCall`, `listSimulatedCalls`, `updateSimulatedCall`, `deleteSimulatedCall`, `countSimulatedCallsToday`. Uses the pg Pool directly (not the IStorage abstraction) because the feature intrinsically requires PostgreSQL — both the durable JobQueue and the simulated_calls table. `isSimulatedCallsAvailable()` returns false when `DATABASE_URL` is unset; routes guard on this before writing.

### Shared schemas

`shared/simulated-call-schema.ts` exports `SimulatedCallScript`, `SimulatedCallConfig`, `GenerateSimulatedCallRequest`, `SimulatedCall`, `SimulatedCallStatus`, and `InsertSimulatedCall`. The script supports spoken turns (agent/customer), hold events with optional music, and interrupt events for overlapping speech.

## Long-Term Improvement Roadmap

See [`docs/improvement-roadmap.md`](docs/improvement-roadmap.md) for the full multi-sprint improvement plan covering testing, security hardening, code quality, accessibility, and infrastructure.

## Cycle Workflow Config

### Test Commands
```bash
npm test                   # Backend (869 tests)
npm run test:client        # Frontend (174 tests)
npm run check              # TypeScript type check
```

### Health Dimensions
Architecture & Code Quality, Security & HIPAA Compliance, Audio Processing Pipeline, AI Analysis Reliability, AWS Integration Reliability, Data Integrity, RAG & Knowledge Base, Operational Integrity, Operational Readiness, Frontend & UX, Feature Completeness, Scoring & Calibration Accuracy

### Subsystems
Core Architecture & Pipeline:
  server/index.ts, server/routes.ts, server/routes/pipeline.ts, server/routes/utils.ts, server/routes/config.ts, server/routes/admin.ts, server/middleware/waf.ts, server/middleware/rate-limit.ts, server/middleware/error-handler.ts, server/types.d.ts, server/vite.ts, server/constants.ts, server/services/job-queue.ts, server/services/logger.ts, server/services/correlation-id.ts, server/services/tracing.ts, server/services/trace-span.ts, server/services/sentry.ts, server/services/websocket.ts, server/services/pipeline-settings.ts
Storage Layer / Database:
  server/storage.ts, server/storage-postgres.ts, server/db/pool.ts, server/db/schema.sql, shared/schema.ts, shared/simulated-call-schema.ts
AI Processing & Analysis:
  server/services/assemblyai.ts, server/services/bedrock.ts, server/services/ai-provider.ts, server/services/ai-factory.ts, server/services/active-model.ts, server/services/model-tiers.ts, server/services/bedrock-batch.ts, server/services/batch-scheduler.ts, server/services/transcribing-reaper.ts, server/services/scoring-calibration.ts, server/services/auto-calibration.ts, server/services/call-clustering.ts, server/services/call-simulator.ts, server/services/audio-stitcher.ts, server/services/disfluency.ts, server/services/circumstance-modifiers.ts, server/services/script-rewriter.ts
Security & Compliance:
  server/auth.ts, server/routes/auth.ts, server/routes/users.ts, server/routes/admin-security.ts, server/services/audit-log.ts, server/services/security-monitor.ts, server/services/vulnerability-scanner.ts, server/services/incident-response.ts, server/services/totp.ts, server/services/phi-redactor.ts, server/services/prompt-guard.ts, server/services/url-validator.ts, server/services/resilience.ts, shared/phi-patterns.ts
AWS & External Integrations:
  server/services/s3.ts, server/services/sigv4.ts, server/services/aws-credentials.ts, server/services/telephony-8x8.ts, server/services/webhooks.ts, server/services/elevenlabs-client.ts
RAG & Knowledge Base:
  server/services/rag-client.ts, server/services/best-practice-ingest.ts, server/services/medical-synonyms.ts, server/services/scoring-feedback.ts
Engagement & Reporting:
  server/services/gamification.ts, server/services/coaching-alerts.ts, server/services/performance-snapshots.ts, server/services/scheduled-reports.ts, server/services/simulated-call-storage.ts, server/routes/coaching.ts, server/routes/gamification.ts, server/routes/analytics.ts, server/routes/reports.ts, server/routes/insights.ts, server/routes/snapshots.ts, server/routes/dashboard.ts, server/routes/employees.ts, server/routes/calls.ts, server/routes/calls-tags.ts, server/routes/admin-operations.ts, server/routes/admin-content.ts, server/routes/simulated-calls.ts
Frontend / UI:
  client/src/App.tsx, client/src/pages/, client/src/components/, client/src/lib/queryClient.ts, client/src/lib/i18n.ts, client/src/lib/constants.ts, client/src/lib/safe-storage.ts, client/src/lib/transcript-search.ts, client/src/hooks/, client/src/index.css, client/index.html, tailwind.config.ts

### Invariant Library
INV-01 | updateCall must throw if employeeId is in the updates payload | Subsystem: Storage
INV-02 | audioProcessingQueue is a shared singleton — never construct a second TaskQueue | Subsystem: Core Architecture
INV-03 | wafPreBody before express.json(), wafPostBody after — ordering is load-bearing | Subsystem: Core Architecture
INV-04 | CallAnalysisSchema must NOT have .catch() on summary/performance_score/sub_scores | Subsystem: AI Processing
INV-05 | requireAuth is async — do not assume sync return | Subsystem: Security
INV-06 | content_hash UNIQUE index must exist in both schema.sql AND runMigrations | Subsystem: Storage
INV-07 | Scoring-correction reason must be sanitized + wrapped in <<<UNTRUSTED_MANAGER_NOTES>>> | Subsystem: RAG & KB
INV-08 | promoteActiveModel must call both aiProvider.setModel() AND bedrockBatchService.setModel() | Subsystem: AI Processing
INV-09 | gracefulShutdown must call jobQueue.stop() BEFORE closePool() | Subsystem: Core Architecture
INV-10 | loadAuditIntegrityChain must retry 3x and throw on exhaustion | Subsystem: Security
INV-11 | AUDIT_HMAC_SECRET must be dedicated in production, not shared with SESSION_SECRET | Subsystem: Security
INV-12 | Tag delete must enforce author-or-manager authorization | Subsystem: Engagement
INV-13 | advanceIncidentPhase/addIncidentTimelineEntry/addActionItem/updateIncidentDetails must be DB-first clone-then-persist | Subsystem: Security
INV-14 | Every manager/admin-gated mutation route must include requireMFASetup | Subsystem: Security
INV-15 | isPasswordReused must slice history to PASSWORD_HISTORY_SIZE before scrypt compares | Subsystem: Security
INV-16 | validateTimestamps must log + flag (output_anomaly:*) on strip, not silently drop | Subsystem: AI Processing
INV-17 | persistBatchJobTracking must retry 3x + fall back to orphaned-submissions/ prefix | Subsystem: AI Processing
INV-18 | runCatchUp must walk back 12 weekly + 12 monthly boundaries, not just one | Subsystem: Engagement
INV-19 | Audit queue overflow must fire one-shot logger.error on first drop | Subsystem: Security
INV-20 | BEDROCK_MODEL validated against BEDROCK_PRICING at startup with logger.warn | Subsystem: Core Architecture
INV-21 | getSessionFingerprint is the single source of truth for fingerprinting | Subsystem: Security
INV-22 | Production hard-fails if S3_BUCKET missing when DATABASE_URL is set | Subsystem: Storage
INV-23 | Sub-scores are camelCase in storage, snake_case at AI boundary — never read storage with snake_case | Subsystem: AI Processing
INV-24 | queryFn default must use on401: returnNull — never change to throw | Subsystem: Frontend
INV-25 | MFA recovery codes must be scrypt-hashed at rest — plaintext never persisted, never recoverable | Subsystem: Security
INV-26 | consumeRecoveryCode must use timingSafeEqual and must NOT short-circuit on early match | Subsystem: Security
INV-27 | MFA pending-token attempt counter must cap at MFA_MAX_ATTEMPTS (5) and invalidate the token on exhaustion | Subsystem: Security
INV-28 | Batch result processor must call storage.getCall(callId) and skip createCallAnalysis when status === "completed" | Subsystem: AI Processing
INV-29 | gracefulShutdown must call all five scheduler stop functions (batch, calibration, telephony, reports, transcribing-reaper) with independent try/catch before jobQueue.stop() | Subsystem: Core Architecture
INV-30 | All scheduler setInterval/setTimeout handles must call .unref() | Subsystem: Core Architecture
INV-31 | createCallAnalysis must preserve manual_edits on conflict (UPSERT with COALESCE on Postgres, equivalent merge on MemStorage/CloudStorage) — reanalyze never destroys manager corrections | Subsystem: Storage
INV-32 | Bedrock circuit breaker must NOT count 4xx (except 429) toward the open threshold — only 5xx + 429 indicate unhealthy upstream | Subsystem: AI Processing
INV-33 | useIdleTimeout must reset on visibilitychange→visible to prevent silent logout while tab is blurred — tab-hidden must NOT reset (HIPAA away-from-machine timeout still applies) | Subsystem: Frontend
INV-34 | Synthetic calls (`calls.synthetic = TRUE`) MUST be excluded from every aggregate / learning / reporting read path: dashboards, leaderboards, performance snapshots, auto-calibration, scoring-feedback corrections, gamification badges/milestones, best-practice KB ingest, coaching alerts, scheduled reports, insights, analytics, filtered reports, and search. Violation poisons scoring for real agents. Guarded by `tests/synthetic-call-isolation.test.ts`. The single intentional exception is `getCallsByStatus` (orphan recovery). | Subsystem: Storage / AI Processing / Engagement
INV-35 | Pipeline learning side-effects (`ingestBestPractice`, `evaluateBadges`, `checkAndCreateCoachingAlert`, `autoAssignEmployee`, score.low/score.exceptional webhooks) MUST skip when `call.synthetic === true`. Scoring-correction capture in PATCH /api/calls/:id/analysis MUST also skip synthetic calls. | Subsystem: AI Processing / Engagement

### Policy Configuration
Policy threshold: 5/10
Consecutive cycles: 2
