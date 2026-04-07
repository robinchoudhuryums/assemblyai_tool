# CallAnalyzer — AI-Powered Call Quality Analysis Platform

## Project Overview
HIPAA-compliant call analysis tool for a medical supply company (UMS). Agents upload call recordings, which are transcribed by AssemblyAI and analyzed by AWS Bedrock (Claude) for performance scoring, compliance, sentiment, and coaching insights.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter (routing), TanStack Query
- **Backend**: Express.js + TypeScript (ESM), runs on Node
- **AI**: AWS Bedrock (Claude Sonnet) for call analysis, AssemblyAI for transcription (with webhook support)
- **Error Tracking**: Sentry (server + client, PHI-safe with scrubbing)
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
npx vite build       # Frontend-only build (useful for quick verification)
```

## Testing
- **Framework**: Node.js built-in `test` module via `tsx` (backend), Vitest + React Testing Library (frontend)
- **Coverage**: Backend ~67% statements / ~85% branches (via `npm run test:coverage`). Frontend lib utilities fully covered.
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
server/services/         # AI provider (Bedrock), AI factory, S3 client, AssemblyAI, WebSocket, job queue, TOTP, security monitor, vulnerability scanner, incident response, batch inference/scheduler, webhooks, coaching alerts, gamification, auto-calibration, telephony-8x8, AWS credentials, URL validator (SSRF), scoring calibration, call clustering, logger, RAG client, RAG hybrid search, prompt guard, PHI redactor, resilience (circuit breaker), correlation ID, tracing (OpenTelemetry), trace spans, medical synonyms, scoring feedback loop, best practice ingestion, error handler middleware
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
| POST | `/api/auth/login` | Login (rate limited: 5 attempts/15min per IP) |
| POST | `/api/auth/logout` | Logout & clear session |
| GET | `/api/auth/me` | Get current user |

### MFA (authenticated)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/auth/mfa/status` | authenticated | Check MFA status for current user |
| POST | `/api/auth/mfa/setup` | authenticated | Generate TOTP secret + otpauth URI |
| POST | `/api/auth/mfa/enable` | authenticated | Verify TOTP code and enable MFA |
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
| GET | `/api/calls` | authenticated | List calls (filtering/pagination) |
| GET | `/api/calls/:id` | authenticated | Get call details |
| POST | `/api/calls/upload` | authenticated | Upload audio (starts pipeline) |
| GET | `/api/calls/:id/audio` | authenticated | Stream audio for playback |
| GET | `/api/calls/:id/transcript` | authenticated | Get transcript |
| GET | `/api/calls/:id/sentiment` | authenticated | Get sentiment analysis |
| GET | `/api/calls/:id/analysis` | authenticated | Get AI analysis |
| PATCH | `/api/calls/:id/analysis` | manager+ | Edit AI analysis |
| PATCH | `/api/calls/:id/assign` | manager+ | Assign call to employee |
| DELETE | `/api/calls/:id` | manager+ | Delete call |
| GET | `/api/calls/:id/tags` | authenticated | Get tags for a call |
| POST | `/api/calls/:id/tags` | authenticated | Add a tag to a call |
| DELETE | `/api/calls/:id/tags/:tagId` | authenticated | Remove a tag from a call |
| GET | `/api/tags` | authenticated | Get all unique tags (for autocomplete) |
| GET | `/api/calls/by-tag/:tag` | authenticated | Search calls by tag |
| GET | `/api/calls/:id/annotations` | authenticated | Get annotations for a call |
| POST | `/api/calls/:id/annotations` | authenticated | Add annotation to a call |
| DELETE | `/api/calls/:id/annotations/:annotationId` | authenticated | Remove an annotation |

### Employees
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/employees` | authenticated | List all employees |
| POST | `/api/employees` | manager+ | Create employee |
| PATCH | `/api/employees/:id` | manager+ | Update employee |
| POST | `/api/employees/import-csv` | admin | Bulk import from CSV |

### Dashboard & Reports
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard/metrics` | authenticated | Call metrics & performance |
| GET | `/api/dashboard/sentiment` | authenticated | Sentiment summaries |
| GET | `/api/dashboard/performers` | authenticated | Top performers |
| GET | `/api/search` | authenticated | Full-text search |
| GET | `/api/performance` | authenticated | Performance metrics |
| GET | `/api/reports/summary` | authenticated | Summary report |
| GET | `/api/reports/filtered` | authenticated | Filtered reports (date range) |
| GET | `/api/reports/agent-profile/:id` | authenticated | Detailed agent profile |
| POST | `/api/reports/agent-summary/:id` | authenticated | Generate agent summary |

### Coaching & Admin
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/coaching` | manager+ | List coaching sessions |
| GET | `/api/coaching/employee/:id` | authenticated | Coaching for employee |
| POST | `/api/coaching` | manager+ | Create coaching session |
| PATCH | `/api/coaching/:id` | manager+ | Update coaching session |
| PATCH | `/api/coaching/:id/action-item/:index` | authenticated | Toggle action item (agents can toggle their own) |
| GET | `/api/prompt-templates` | admin | List prompt templates |
| POST | `/api/prompt-templates` | admin | Create prompt template |
| PATCH | `/api/prompt-templates/:id` | admin | Update prompt template |
| DELETE | `/api/prompt-templates/:id` | admin | Delete prompt template |
| GET | `/api/insights` | authenticated | Aggregate insights & trends |
| GET | `/api/admin/queue-status` | admin | Job queue stats (pending, running, completed, failed) |
| GET | `/api/admin/dead-jobs` | admin | List dead-letter jobs (failed after max retries) |
| POST | `/api/admin/dead-jobs/:id/retry` | admin | Retry a dead-letter job |
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
| GET | `/api/analytics/team/:teamName` | authenticated | Individual employee metrics within a team |
| GET | `/api/analytics/trends` | authenticated | Week-over-week/month-over-month company-wide trends |
| GET | `/api/analytics/trends/agent/:employeeId` | authenticated | Agent-specific performance trends |
| GET | `/api/analytics/speech/:callId` | authenticated | Speech metrics for a single call (interruptions, latency, talk time) |
| GET | `/api/analytics/speech-summary` | authenticated | Aggregate speech metrics across agents (query: `days`) |
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
| GET | `/api/snapshots/employee/:id` | authenticated | Get employee snapshot history |
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
| POST | `/api/ab-tests/upload` | admin | Upload audio + specify test model → starts comparison |
| DELETE | `/api/ab-tests/:id` | admin | Delete a test |

**A/B Test Processing Pipeline** (`server/routes.ts → processABTest`):
1. Upload audio to AssemblyAI → transcribe (same as normal pipeline)
2. Run baseline model (current production Sonnet) and test model in parallel (both timed)
3. Store both analyses + latency to `ab-tests/` S3 prefix
4. WebSocket notifies client on completion

Test calls are stored separately from production data (`ab-tests/{id}.json`), never assigned to employees, and never included in dashboard metrics, reports, or performance scores.

### Usage / Spend Tracking (admin only)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/usage` | admin | List all usage records with estimated costs |

Usage records are automatically created after each call analysis and A/B test. Estimated costs are calculated from audio duration (AssemblyAI) and token counts (Bedrock). Stored under `usage/` S3 prefix. The admin Spend Tracking page shows current month, last month, YTD, and all-time views with charts.

### Gamification (authenticated)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/gamification/leaderboard` | authenticated | Agent leaderboard (query: `period=week\|month\|all`) |
| GET | `/api/gamification/badges/:employeeId` | authenticated | Badges earned by an employee |
| GET | `/api/gamification/badge-types` | authenticated | All possible badge definitions |
| GET | `/api/gamification/stats/:employeeId` | authenticated | Points, streak, and badges for one agent |

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
| **viewer** | Read-only: dashboards, reports, transcripts, call playback, team data |
| **manager** | Everything viewer can do, plus: assign calls, edit AI analysis, manage employees, create coaching sessions, export reports, delete calls |
| **admin** | Full control: manage users, approve/deny access requests, bulk CSV import, prompt template CRUD, A/B model testing, spend tracking, system configuration |

Access requests can request "viewer" or "manager" roles (not admin).

## Environment Variables
```
# Required
ASSEMBLYAI_API_KEY              # Transcription service
SESSION_SECRET                  # Cookie signing

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

# AI Model
BEDROCK_MODEL                   # Default: us.anthropic.claude-sonnet-4-6 (see server/services/bedrock.ts)
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

# Sentry (Error Tracking)
SENTRY_DSN                      # Sentry DSN for server-side error tracking (optional)
VITE_SENTRY_DSN                 # Sentry DSN for client-side error tracking (optional, set at build time)

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
| **Audit log durability** | `server/services/audit-log.ts` | Write-ahead queue with batched INSERT (up to 100 rows/flush, 2s interval), strict-FIFO drain from queue head, per-row fallback on batch failure, retry with exponential backoff, graceful shutdown flush, health endpoint monitoring |
| **Graceful shutdown** | `server/index.ts` | SIGINT/SIGTERM flush audit log queue before exit |
| **Vulnerability scanning** | `server/services/vulnerability-scanner.ts` | Automated daily scans of env config, dependencies, database, auth; admin can trigger manual scans |
| **Incident response** | `server/services/incident-response.ts` | Formal IRP with severity classification, phase tracking, escalation contacts, response procedures, action items |
| **Disaster recovery** | `docs/disaster-recovery.md` | DR plan: S3 CRR, RDS cross-region replica, AMI snapshots, Route 53 DNS failover |
| **PHI redaction in logs** | `server/services/phi-redactor.ts` | 14 regex patterns (SSN, DOB, MRN, phone, email, address, Medicare/Medicaid IDs, names) auto-redact the `detail` field in all audit entries before persistence |
| **Prompt injection detection** | `server/services/prompt-guard.ts` | 16 input patterns + output anomaly detection scan transcripts before Bedrock analysis; flags calls but doesn't block (spoken injection is a real attack vector) |
| **Circuit breaker** | `server/services/resilience.ts` | Wraps all Bedrock calls; 5 failures → open for 30s → half-open test; prevents job queue from hammering a down service |
| **Idle timeout warning** | `client/src/hooks/use-idle-timeout.ts` | 2-minute countdown dialog before auto-logout at 15 min idle; any activity resets timer |
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
- **Content hash uniqueness is DB-enforced** (A21): `UNIQUE INDEX idx_calls_content_hash_unique` rejects duplicate uploads at insert time; route handler catches pg 23505 and 409s. Replaces the prior O(n) scan over `getAllCalls`.
- **CSV import contract change** (A29): switched from server-side file read (`./employees.csv`) to multipart upload. Closes a file-write injection hole and ends pm2 working-directory fragility, but breaks any admin automation relying on the old path.
- **Sentry beforeSend is fail-open**: on scrubber exception, the event is returned *unmodified* rather than dropped. Observability path priority — dropping events on scrubber bugs would blind us to both the original error and the bug. Trade-off: brief PHI-in-Sentry window during a scrubber bug, bounded by `console.error` alerting.
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
- **AI error classification**: Pipeline distinguishes parse failures (malformed JSON) from provider unavailability — different Sentry tags and log levels. Parse failures now trigger a 1-shot Bedrock retry before falling through to the no-AI path (A12).
- **`bedrockProvider.isAvailable` is no longer optimistic** (A8/F07) — previously returned `true` before IMDS was tried. Now returns `false` until env vars are present or `ensureCredentials()` has been called once. On EC2 instance-profile-only deployments, `aiProvider.isAvailable` reports `false` at boot and AI analysis is skipped until something fires `ensureCredentials()`. Eager-resolution at startup is a planned follow-up.
- **`CallAnalysisSchema` no longer silently defaults `summary`/`performance_score`/`sub_scores`** (A12/F17) — malformed AI responses previously produced "completed" calls with placeholder 5.0 scores and `"No summary available"`. Now invalid output throws inside `parseJsonResponse` and the pipeline retries Bedrock once before falling through to the no-AI path. Doubles Bedrock cost on parse failures and consumes 2 circuit-breaker slots per failed call (breaker threshold is 5 — comfortable). Batched calls that previously silently completed with 5.0 placeholders are now marked failed.
- **`CalibrationSnapshot.recommended.spread` is intentionally absent** (A14/F15) — the prior derivation (`targetSpread / observedSpread`) was dimensionally wrong. The field was removed but `POST /api/admin/calibration/apply` still requires `spread` in the body. Operators must supply it manually; no admin UI exists today, so zero current callers.
- **AI subsystem logs are structured JSON via `logger.*`** (A10/F18) — `assemblyai.ts`, `bedrock.ts`, `bedrock-batch.ts`, `batch-scheduler.ts`, `auto-calibration.ts`, `scoring-calibration.ts`, `scoring-feedback.ts`, `ai-provider.ts`, `ai-factory.ts` no longer use `console.*`. External log scrapers parsing `[BATCH]` / `[CALIBRATION]` bracket prefixes from stdout now see structured JSON with `callId` as a field, not interpolation.
- **Fire-and-forget Sentry**: Background tasks (embeddings, coaching alerts, badges, webhooks) report errors to Sentry via `captureException()`, not just `console.warn`
- **`updateCall` is employeeId-free** (A6/F14): all three storage backends throw if `employeeId` appears in the updates payload. The manager-facing PATCH /api/calls/:id/assign route uses the new `setCallEmployee` method; pipeline auto-assignment uses `atomicAssignEmployee`. Closes a silent-clobber race where status updates would re-write a stale `employee_id` from a prior read.
- **PostgresStorage password history is JS-side** (A3/F02): `updateDbUserPassword` reads the existing history, prepends + slices to 5, and writes it back in a single UPDATE. Replaces an opaque jsonb_array_elements_text aggregation. Trade-off: small lost-update window on concurrent password changes (admin reset racing self-change). Acceptable because concurrent rotations are vanishingly rare.
- **Production requires `S3_BUCKET`** (A1/F03): `createStorage()` throws at boot when `NODE_ENV=production` and `DATABASE_URL` is set but `S3_BUCKET` is not. Replaces a silent-degraded path where audio uploads would fail at runtime instead of at startup.
- **CloudStorage deprecated behind `s3-legacy` opt-in** (A12/F08, F17): the `STORAGE_BACKEND=s3` value now throws at startup; `s3-legacy` activates CloudStorage with a deprecation WARN. The implicit `S3_BUCKET`-only trigger was also removed because it was the same silent-degraded path the deprecation closes. Trade-off: an operator updating a stale `.env` will see boot fail rather than silently activate the deprecated backend — intentional, but requires comms before deploy.

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
Runs on every push to `main` and every PR. Two parallel jobs:
1. **Test & Build** — type check (`tsc`), backend unit tests (`npm test`), frontend unit tests (`npm run test:client`), production build
2. **Dependency Audit** — `npm audit` for vulnerabilities; blocks on critical severity

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
- **Incident routes 500 on missing `incidents` table** (A7) — `persistIncident` and `createBreachReport` now throw on DB write failure (DB-first persist; in-memory cache only updated after successful persist). On a fresh deploy without `initializeDatabase()` having run, `/api/admin/incidents/*` will 500 instead of silently caching in memory. Run schema migration before exercising admin incident routes.
- **Incident/breach/alert IDs are opaque UUIDs** (A7) — `INC-<uuid>`, `breach-<uuid>`, `alert-<uuid>`. Old `Date.now()`-based IDs were parseable but collision-prone within the same millisecond. Anything that tried to extract a timestamp from an ID needs to read `declaredAt`/`reportedAt` instead.
- **Auth / security / incident logs are structured JSON via `logger.*`** (A11) — `[AUTH]`, `[SECURITY]`, `[INCIDENT]` bracket prefixes are gone. External scrapers grepping for those literal strings will silently match nothing. The `[HIPAA_AUDIT]` stdout line is intentionally preserved (canonical chain record).
- **`/api/admin/waf/block-ip` enforces a 30-day max `durationMs`** (A9) — Zod schema rejects values >30 days with a 400. Permanent blocks should omit `durationMs` entirely. Operator scripts that hardcoded multi-month "temporary" blocks must switch to permanent or chunk the duration.
- **Vuln-scanner history retains hollow entries past `MAX_SCAN_HISTORY`** (A12) — older scan reports stay in `scanHistory` with `findings: []` while their summary remains. Frontend code iterating history must expect `findings.length === 0` on archived scans (summary counts are still valid). Previously the entries were `shift()`-ed out entirely; the comment claimed "summary is retained" but it wasn't.
- **`/api/admin/*` mounts `requireMFASetup`** (A3) — when `isMFARoleRequired("admin")` returns true (i.e. `REQUIRE_MFA=true`), all admin routes 403 for admins without an enrolled TOTP secret. Enrollment endpoints `/api/auth/mfa/setup` and `/api/auth/mfa/enable` are unaffected. **Operational footgun:** flipping `REQUIRE_MFA=true` without enrolling admins first will lock them out of admin functions on their next request.
- **`deserializeUser` propagates transient DB errors** (A10) — DB blips during session deserialization now surface as 500 errors instead of silently falling through to env users. Env-user fallback is reserved for "DB returned no rows" (success), not "DB unreachable" (error). Tradeoff: better security posture, worse availability under DB instability.
- **`AUDIT_HMAC_SECRET` is required in production** (A4) — production boot-fails if unset. The audit chain previously fell back to `SESSION_SECRET`, which silently broke chain verification on session-secret rotation. Add `AUDIT_HMAC_SECRET` to the EC2 `.env` file before next deploy.
- **`LocalStrategy` uses `passReqToCallback`** (A2) — verify callback signature is `(req, username, password, done)`. Client IP is extracted from `req.ip || req.socket.remoteAddress` and passed to `recordFailedAttempt(username, ip)` → `security-monitor.recordFailedLogin`. Brute-force / credential-stuffing alerts depend on this IP and were never firing before A2.
- **`audit_log_integrity` is a singleton row** (A6) — `id=1` is the only legal row, seeded with `'genesis'` on first boot. `loadAuditIntegrityChain()` runs in `server/index.ts` startup right after `initializeDatabase()` and restores the chain head. `persistPreviousHash` is fire-and-forget per `logPhiAccess` call — the in-memory head can drift ahead of the persisted head during a crash mid-burst, in which case the chain breaks at the gap (stdout retains the canonical record).
- **processAudioFile signature is `(callId, audio, options)`** (A22) — not the old 9-positional shape. `audio` is a Buffer; the options object carries originalName, mimeType, callCategory?, uploadedBy?, processingMode?, language?, filePath?. Telephony scheduler and job worker both use this shape.
- **Job queue attempts increment only on failJob** (A18) — a worker crash no longer burns an attempt by itself. Stale-heartbeat reap calls failJob explicitly, so a job with a flapping DB connection can still burn the retry budget through repeated reaps. Heartbeat every 30s; stale threshold 2min.
- **Upgrading an existing DB to the A18 schema leaves orphan 'running' jobs unreapable** — `last_heartbeat_at` is NULL and the reaper's `<` comparison skips NULLs. On first deploy, run `UPDATE jobs SET last_heartbeat_at = NOW() WHERE status = 'running' AND last_heartbeat_at IS NULL;` before expecting reap to work on stale jobs.
- **estimateBedrockCost returns `number | null`** (A27) — unknown models return null. Unknown-model usage records store `estimatedCost: 0`, not a Sonnet ballpark. Adding a new BEDROCK_MODEL requires updating `BEDROCK_PRICING` in `server/routes/utils.ts` or cost tracking silently zeroes.
- **`/api/calls` offset mode is gone** (A20) — `?page=2` silently returns page 1. Frontend must send `?cursor=<token>`; consume `nextCursor` from the response.
- **`/api/employees` paginates by default** (A20) — default limit=50, max=500. Response is a bare `Employee[]`; total in `X-Total-Count` header, `X-Pagination-Default: true` if the client omitted `?limit`. Any code iterating the response assuming "all employees" will silently truncate.
- **CSV import is multipart upload** (A29) — POST /api/employees/import-csv expects `multipart/form-data` with a `file` field. The old "read `./employees.csv` from server cwd" behavior is gone.
- **`uploadsDir` is `path.resolve(cwd, "uploads")`** (A42) — absolute. pm2 working-directory changes no longer strand uploads.
- **Graceful shutdown does NOT stop JobQueue** (A34, known gap) — in-flight jobs crash mid-pipeline on SIGTERM. Audit queue is flushed and DB pool is closed; JobQueue poll loop crashes harmlessly on closed connection.
- **PATCH /api/calls/:id/analysis** is strict-whitelisted via `analysisEditSchema.strict()`. Adding a new editable field requires editing `shared/schema.ts`; passing unknown keys is rejected with 400.
- **audioProcessingQueue** is a single shared singleton exported from `server/routes/pipeline.ts`. A/B test uploads, bulk re-analysis, and normal call uploads compete for the same concurrency slots. Don't construct `new TaskQueue()` in a route file — import the singleton.
- **Global JSON body limit is 1MB** (`express.json({limit:"1mb"})` in `server/index.ts`). Routes that legitimately need larger payloads must mount a per-route `express.json({limit:...})` override before the route handler.
- **WAF is two middlewares**, not one: `wafPreBody` runs before body parsing (inspects URL/query/headers/IP), `wafPostBody` runs after (inspects `req.body`, no-ops on multipart). Do not reorder them in `index.ts`.
- **Logger meta is PHI-scrubbed** recursively via `phi-redactor.ts` in `logger.emit()` (depth=6, WeakSet cycle detection, 10KB string cap). Formatted numeric strings that look like phone numbers will show as `[REDACTED-PHONE]` in log output.
- **Sentry namespace export removed** — import `captureException` / `captureMessage` from `server/services/sentry.ts`. Direct `Sentry.*` access bypassed PHI scrubbing and is no longer available.
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

## Systems Map

### Module Map

| Module | Files | Responsibility |
|--------|-------|---------------|
| **Server Entry** | `server/index.ts`, `server/vite.ts`, `server/types.d.ts` | Express bootstrap. Middleware order: X-Forwarded-For validation → correlation ID (UUID-validated, truncated, falls back to randomUUID) → HTTPS redirect → CORS → `wafPreBody` → `express.json({limit:"1mb"})` → `express.urlencoded({limit:"1mb"})` → `wafPostBody` → security headers → audit logging → CSRF double-submit (timingSafeEqual on hashed tokens) → legacy CSRF Content-Type check → routes → `globalErrorHandler` (AppError-aware, transitional `{message, error:{...}}` shape, prod 5xx sanitization). Env validation, graceful shutdown, Vite dev server integration. `types.d.ts` holds Express.User and SessionData type augmentations. |
| **Route Coordinator** | `server/routes.ts` | Registers all 12 sub-routers, configures multer, initializes job queue + batch scheduler + calibration + telephony schedulers, handles AssemblyAI webhook endpoint |
| **Auth & Sessions** | `server/auth.ts`, `server/routes/auth.ts` | Passport.js local strategy, session management (PostgreSQL or memorystore), password hashing/complexity, account lockout, session fingerprinting, MFA two-step flow |
| **Call Routes** | `server/routes/calls.ts`, `server/routes/calls-tags.ts` | Call CRUD, audio streaming, transcript/sentiment/analysis retrieval, tagging, annotations |
| **Pipeline** | `server/routes/pipeline.ts` | Core audio processing: transcription → quality gates → RAG fetch → injection detection → AI analysis → score calibration → storage → coaching/badges/webhooks |
| **Route Utilities** | `server/routes/utils.ts` | Shared helpers: `sendError`, `sendValidationError`, `validateParams`, `validateIdParam`, `safeFloat`, `safeJsonParse`, `clampInt`, `parseDate`, `TaskQueue` (with `QueueFullError`/`TaskTimeoutError`, `maxQueueSize=1000`, `taskTimeoutMs=10min` bounds), `computeConfidenceScore`, `autoAssignEmployee`, `cleanupFile`, `escapeCsvValue`, `filterCallsByDateRange`, `countFrequency`, `calculateSentimentBreakdown`, `calculateAvgScore`, `estimateBedrockCost`, `estimateAssemblyAICost`, `estimateEmbeddingCost`. **Note:** `requireRole` is exported from `server/auth.ts`; `asyncHandler` is exported from `server/middleware/error-handler.ts` (not utils.ts). |
| **Admin Routes** | `server/routes/admin.ts`, `admin-security.ts`, `admin-operations.ts`, `admin-content.ts` | Admin facade delegating to security (WAF, incidents, vulns), operations (queue, batch, calibration, telephony), and content (templates, A/B tests, webhooks, usage) |
| **Employee Routes** | `server/routes/employees.ts` | Employee CRUD, bulk CSV import |
| **Dashboard & Metrics** | `server/routes/dashboard.ts` | Dashboard metrics, sentiment distribution, top performers, flagged calls |
| **Analytics** | `server/routes/analytics.ts` | Team analytics, trends, speech metrics, call clustering, CSV export, heatmaps |
| **Reports** | `server/routes/reports.ts` | Search, agent profiles, filtered reports, AI-generated agent summaries |
| **Coaching** | `server/routes/coaching.ts` | Coaching session CRUD, action item toggling, webhook triggers |
| **Users** | `server/routes/users.ts` | User management (admin CRUD, password reset/change, MFA) |
| **Snapshots** | `server/routes/snapshots.ts` | Performance snapshot generation/retrieval (employee/team/dept/company) |
| **Gamification** | `server/routes/gamification.ts` | Leaderboard, badges, points, stats |
| **Insights** | `server/routes/insights.ts` | Aggregate topic frequency, complaint patterns, escalation trends |
| **Storage** | `server/storage.ts`, `server/storage-postgres.ts` | `IStorage` interface (~35 methods, A7 added `getCallsByStatus(status)` and `getCallsSince(date)` — indexed lookups that replaced `getAllCalls` scans in batch orphan recovery and auto-calibration), three backends: PostgresStorage (RDS), CloudStorage (S3-only legacy), MemStorage (in-memory dev fallback). New in A21/A20: `findCallByContentHash`, `getEmployeesPaginated`. `atomicAssignEmployee` contract documented for all three backends (A44). Batch 1 (A6/F14): `setCallEmployee` added for explicit reassign/unassign; `updateCall` now throws if `employeeId` is in the updates payload. PostgresStorage `updateCall` uses a dynamic SET clause keyed by COLUMN_MAP — adding a new persisted column requires both a schema migration and a COLUMN_MAP entry. |
| **Database** | `server/db/pool.ts`, `server/db/schema.sql` | PostgreSQL connection pool (singleton), auto-schema initialization, incremental migrations, SSL enforcement |
| **AssemblyAI** | `server/services/assemblyai.ts` | Audio transcription (webhook + polling modes), speaker-labeled transcript building, utterance metrics, transcript data normalization |
| **Bedrock AI** | `server/services/bedrock.ts`, `server/services/ai-provider.ts`, `server/services/ai-factory.ts` | AWS Bedrock Converse API (raw SigV4, no SDK), prompt building, JSON response parsing, `aiProvider` singleton factory |
| **Batch Inference** | `server/services/bedrock-batch.ts`, `server/services/batch-scheduler.ts` | Deferred AI analysis via JSONL to S3, periodic job submission/polling/recovery. `bedrock-batch.ts` uses `sigv4.ts` directly for S3 operations, resolves AWS creds lazily via `getAwsCredentials()` (env→IMDS), validates `BEDROCK_BATCH_ROLE_ARN`, and paginates `s3List` via continuation token (50-page safety cap). |
| **Scoring** | `server/services/scoring-calibration.ts`, `server/services/auto-calibration.ts`, `server/services/scoring-feedback.ts` | Score normalization, periodic distribution analysis, manager correction capture for future prompt injection |
| **AWS Infrastructure** | `server/services/s3.ts`, `server/services/sigv4.ts`, `server/services/aws-credentials.ts` | Custom S3 REST client (single consumer: `storage.ts`), SigV4 signing, credential resolution (env vars + IMDS with caching) |
| **RAG** | `server/services/rag-client.ts` | Knowledge base integration with LFU cache, confidence filtering, graceful fallback |
| **Security** | `server/services/audit-log.ts`, `server/services/security-monitor.ts`, `server/services/vulnerability-scanner.ts`, `server/services/incident-response.ts` | HIPAA audit logging (dual-write, HMAC chain, persistent integrity head), brute-force/credential stuffing detection (wired to client IP via `passReqToCallback`), automated vuln scanning (history retains hollow entries past cap, summary kept), incident lifecycle management (DB-first persist; randomUUID IDs; throws on persist failure) |
| **MFA** | `server/services/totp.ts` | RFC 6238 TOTP with replay protection, used-token cache. `requireMFASetup` (in `server/auth.ts`) is mounted on `/api/admin/*` and gates admin routes when `isMFARoleRequired(role)` returns true |
| **PHI Protection** | `server/services/phi-redactor.ts`, `server/services/prompt-guard.ts` | 14-pattern PHI redaction for audit logs; 16-pattern prompt injection detection + output anomaly scanning |
| **SSRF Protection** | `server/services/url-validator.ts` | URL validator blocking private IPs, metadata endpoints, DNS resolution to private ranges |
| **Resilience** | `server/services/resilience.ts` | Circuit breaker (5 failures → 30s open → half-open test) wrapping Bedrock calls (single consumer: `bedrock.ts`) |
| **Job Queue** | `server/services/job-queue.ts` | PostgreSQL-backed durable queue with `FOR UPDATE SKIP LOCKED`, 30s worker heartbeat, 2min stale reap, attempts-on-failJob contract (A18). |
| **WebSocket** | `server/services/websocket.ts` | Authenticated WebSocket server broadcasting real-time call processing status |
| **Webhooks** | `server/services/webhooks.ts` | HMAC-signed HTTP POST notifications on call events with retry logic and SSRF validation |
| **Coaching Alerts** | `server/services/coaching-alerts.ts` | Auto-creates coaching sessions for low/high-score calls, detects recurring weaknesses |
| **Gamification Service** | `server/services/gamification.ts` | Badge evaluation (12 types), points/streak computation, leaderboard queries |
| **Snapshots Service** | `server/services/performance-snapshots.ts` | AI-generated narrative + numerical performance snapshots at multiple levels |
| **Best Practice Ingest** | `server/services/best-practice-ingest.ts` | Auto-ingests exceptional calls (score ≥9.0) to knowledge base |
| **Call Clustering** | `server/services/call-clustering.ts` | Groups calls by topic similarity using TF-IDF cosine similarity |
| **Medical Synonyms** | `server/services/medical-synonyms.ts` | Expands medical abbreviations in search queries |
| **Telephony** | `server/services/telephony-8x8.ts` | 8x8 auto-ingestion framework (stub, pending API access) |
| **Scheduled Reports** | `server/services/scheduled-reports.ts` | Weekly/monthly performance summary generation (dynamically imported by `routes.ts`) |
| **Observability** | `server/services/logger.ts`, `server/services/correlation-id.ts`, `server/services/tracing.ts`, `server/services/trace-span.ts`, `server/services/sentry.ts` | Structured JSON logging, per-request correlation IDs, OpenTelemetry tracing, PHI-scrubbing Sentry integration |
| **Middleware** | `server/middleware/waf.ts`, `server/middleware/rate-limit.ts`, `server/middleware/error-handler.ts` | WAF split into `wafPreBody`/`wafPostBody` passes (pre runs before body parser, post after — no-ops on multipart); per-user rate limiting with LRU-bounded maps (10k cap); `AppError` + `globalErrorHandler` with transitional `{message, error:{code,message,detail?}}` response shape and prod 5xx sanitization. |
| **Shared Schema** | `shared/schema.ts` | Zod schemas for all entities, shared between client and server |
| **Constants** | `server/constants.ts` | Centralized scoring thresholds (env-configurable) |
| **Frontend Entry** | `client/src/main.tsx`, `client/src/App.tsx` | React SPA root: auth gate, 25 lazy-loaded pages, WebSocket connection, idle timeout, keyboard shortcuts |
| **Frontend Lib** | `client/src/lib/` | TanStack Query setup (`queryClient.ts`), i18n, appearance/theme, Sentry, saved filters, display utils, constants |
| **Frontend Hooks** | `client/src/hooks/` | `useWebSocket`, `useIdleTimeout`, `useBeforeUnload` |
| **Frontend Pages** | `client/src/pages/` | 25+ page components (dashboard, upload, transcripts, reports, coaching, admin, leaderboard, etc.) |
| **Frontend Components** | `client/src/components/` | Layout (sidebar), UI (shadcn/ui), backgrounds, error boundary, file upload |

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
    23. [Fire-and-forget] Coaching alerts [coaching-alerts.ts]
    24. [Fire-and-forget] Badge evaluation [gamification.ts]
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
    → Lookup pending token → getMFASecret → verifyTOTP (timing-safe)
    → req.login(user, { keepSessionInfo: true }) → bindSessionFingerprint
  → Else Step 1 (password):
    → passport.authenticate("local") → account lockout check
    → DB user lookup [storage] or AUTH_USERS env var fallback
    → Password verify (scrypt + timingSafeEqual)
    → If MFA enabled → issue mfaToken, return { mfaRequired: true }
    → If MFA required but not set up → login + { mfaSetupRequired: true }
    → Standard login → req.login() + bindSessionFingerprint()
  → Session stored in PostgreSQL (connect-pg-simple) or memorystore

Every subsequent request:
  → requireAuth → session validation → fingerprint check (UA + accept-language hash)
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
| **Sentry** | Error tracking (server + client), PHI-scrubbed | `server/services/sentry.ts`, `client/src/lib/sentry.ts` |
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
- `server/services/resilience.ts` → circuit breaker consumed by `bedrock.ts` ONLY — VERIFIED
- `server/services/audit-log.ts` → exports `logPhiAccess`, `flushAuditQueue`, `auditContext` (used by `routes/auth.ts` and other route files for extracting audit context), `AuditEntry`, `getDroppedAuditEntryCount`, `getPendingAuditEntryCount` — VERIFIED

### Complexity & Risk Rankings

**Highest-complexity subsystems (most likely to contain hidden issues):**
1. **Audio Processing Pipeline** (`server/routes/pipeline.ts`) — 600+ lines, 10+ async steps, dual-mode, 6 fire-and-forget side effects, quality gates, cost optimization branching
2. **Storage Abstraction** (`server/storage.ts` + `server/storage-postgres.ts`) — 30+ method interface, 3 backends, manual SQL with dynamic WHERE clauses, no query builder
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
- `server/services/scheduled-reports.ts` is not documented in API routes (dynamically imported by `routes.ts`)
- `@replit/vite-plugin-*` packages remain in devDependencies but are unused in `vite.config.ts`
- Improvement roadmap lists "Structured observability" and "correlation IDs" as TODO but both are implemented

## Long-Term Improvement Roadmap

See [`docs/improvement-roadmap.md`](docs/improvement-roadmap.md) for the full multi-sprint improvement plan covering testing, security hardening, code quality, accessibility, and infrastructure.
