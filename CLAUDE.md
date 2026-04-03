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
server/services/         # AI provider (Bedrock), AI factory, S3 client, AssemblyAI, WebSocket, job queue, TOTP, security monitor, vulnerability scanner, incident response, batch inference/scheduler, webhooks, coaching alerts, gamification, auto-calibration, telephony-8x8, AWS credentials, URL validator (SSRF), scoring calibration, call clustering, logger
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
- Stale job reclaim after 10 minutes of inactivity

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
2. `STORAGE_BACKEND=s3` or `S3_BUCKET` env var → **CloudStorage** (legacy, all data as JSON in S3)
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

# RAG Knowledge Base (planned — ums-knowledge-reference integration)
RAG_SERVICE_URL                 # URL of the knowledge reference API
RAG_ENABLED                     # Set to "true" to enable RAG context injection (default: disabled)

# Auto-Calibration
CALIBRATION_INTERVAL_HOURS      # How often to run score distribution analysis (default: 24)
CALIBRATION_WINDOW_DAYS         # Days of call data to analyze for calibration (default: 30)

# 8x8 Telephony Integration
TELEPHONY_8X8_ENABLED           # Set to "true" to enable auto-ingestion from 8x8 (default: disabled)
TELEPHONY_8X8_API_KEY           # 8x8 Work API key
TELEPHONY_8X8_SUBACCOUNT_ID     # 8x8 subaccount ID
TELEPHONY_8X8_POLL_MINUTES      # How often to poll for new recordings (default: 15)
TELEPHONY_8X8_BASE_URL          # 8x8 API base URL (override for testing)

# Optional
PORT                            # Default: 5000
RETENTION_DAYS                  # Auto-purge calls older than N days (default: 90)
JOB_CONCURRENCY                 # Max parallel audio processing jobs (default: 5, requires DATABASE_URL)
JOB_POLL_INTERVAL_MS            # How often to check for new jobs (default: 5000, requires DATABASE_URL)
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
| **Webhook secret enforcement** | `server/routes.ts` | AssemblyAI webhook endpoint rejects unverified payloads in production when `ASSEMBLYAI_WEBHOOK_SECRET` is not set |
| **SSRF protection** | `server/services/url-validator.ts` | Shared URL validator: blocks localhost, private/reserved IPs (RFC 1918/6598), cloud metadata endpoints (AWS/GCP/Azure/Alibaba), .local/.internal hostnames, IPv6-mapped IPv4, DNS resolution to private IPs; enforces HTTPS in production; applied to webhook create, update, and delivery |
| **Startup env validation** | `server/index.ts` | Critical config (`SESSION_SECRET`, API keys, `DATABASE_URL`) validated at boot with clear warnings/errors |
| **CSRF protection** | `server/index.ts` | JSON requests require `Content-Type: application/json`; file uploads require `X-Requested-With` header; both prevent cross-origin form submissions |
| **Admin action audit** | `server/routes/admin-*.ts` | WAF IP block/unblock and dead-job retry actions logged to HIPAA audit trail |
| **Error sanitization** | `server/services/bedrock.ts` | Bedrock API errors logged server-side with details; client receives sanitized category only (no AWS account IDs, ARNs, or model details) |
| **Breach notification** | `server/services/security-monitor.ts` | HIPAA §164.408 breach reporting with timeline tracking, notification status |
| **Security monitoring** | `server/services/security-monitor.ts` | Detects distributed brute-force, credential stuffing, bulk data exfiltration |
| **Read rate limiting** | `server/index.ts` | 60 req/min on data endpoints; 5 req/min on exports (prevents bulk exfiltration) |
| **WAF** | `server/middleware/waf.ts` | Application-level firewall: SQL injection, XSS, path traversal detection; IP blocklist with anomaly scoring; suspicious bot blocking; input truncation (4KB) prevents regex DoS |
| **Audit log integrity** | `server/services/audit-log.ts` | HMAC-SHA256 chain on stdout entries — each hash covers content + previous hash; tampering/deletion breaks the chain |
| **TOTP replay protection** | `server/services/totp.ts` | Used-token cache prevents same TOTP code from being reused within the same time window |
| **Route param validation** | `server/routes/utils.ts` | `validateParams()` middleware rejects malformed UUIDs, IDs, and names before they reach DB queries (30+ routes) |
| **Audit log durability** | `server/services/audit-log.ts` | Write-ahead queue with batch flush (2s interval), retry with exponential backoff, graceful shutdown flush, health endpoint monitoring |
| **Graceful shutdown** | `server/index.ts` | SIGINT/SIGTERM flush audit log queue before exit |
| **Vulnerability scanning** | `server/services/vulnerability-scanner.ts` | Automated daily scans of env config, dependencies, database, auth; admin can trigger manual scans |
| **Incident response** | `server/services/incident-response.ts` | Formal IRP with severity classification, phase tracking, escalation contacts, response procedures, action items |
| **Disaster recovery** | `docs/disaster-recovery.md` | DR plan: S3 CRR, RDS cross-region replica, AMI snapshots, Route 53 DNS failover |

## Key Design Decisions
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
- **AI error classification**: Pipeline distinguishes parse failures (malformed JSON) from provider unavailability — different Sentry tags and log levels
- **Fire-and-forget Sentry**: Background tasks (embeddings, coaching alerts, badges, webhooks) report errors to Sentry via `captureException()`, not just `console.warn`

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

## Planned Integration: RAG Knowledge Base (ums-knowledge-reference)

CallAnalyzer will integrate with the **ums-knowledge-reference** repository to ground AI analysis in company-specific documentation. This RAG (Retrieval-Augmented Generation) system will:

1. **Ingest reference documents** (SOPs, compliance guides, product catalogs, scripts) from the UMS knowledge base
2. **Retrieve relevant context** at analysis time — when Bedrock analyzes a call transcript, the system will query the knowledge base for relevant company policies, required phrases, and procedures
3. **Improve scoring accuracy** by evaluating agents against actual company standards rather than generic best practices
4. **Enhance coaching recommendations** with specific references to company training materials

### Integration Architecture
- The `ums-knowledge-reference` repo provides a standalone RAG service (document ingestion, chunking, embedding, vector search)
- CallAnalyzer will call the RAG service during the AI analysis step (Step 4 of the pipeline) to fetch relevant context
- Retrieved context will be injected into the Bedrock analysis prompt alongside the transcript
- Environment variables: `RAG_SERVICE_URL` (URL of the knowledge reference API), `RAG_ENABLED` (toggle, default false)
- Graceful fallback: if RAG service is unavailable, analysis proceeds without additional context (current behavior)

### Integration Points in CallAnalyzer
- `server/routes/pipeline.ts:processAudioFile()` — fetch RAG context before AI analysis
- `server/services/ai-provider.ts:buildAnalysisPrompt()` — accept and inject RAG context into prompt
- `server/services/coaching-alerts.ts` — reference knowledge base materials in coaching plans

## Common Gotchas
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

## Long-Term Improvement Roadmap

See [`docs/improvement-roadmap.md`](docs/improvement-roadmap.md) for the full multi-sprint improvement plan covering testing, security hardening, code quality, accessibility, and infrastructure.
