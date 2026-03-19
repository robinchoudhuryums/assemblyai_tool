# CallAnalyzer — AI-Powered Call Quality Analysis Platform

## Project Overview
HIPAA-compliant call analysis tool for a medical supply company (UMS). Agents upload call recordings, which are transcribed by AssemblyAI and analyzed by AWS Bedrock (Claude) for performance scoring, compliance, sentiment, and coaching insights.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter (routing), TanStack Query
- **Backend**: Express.js + TypeScript (ESM), runs on Node
- **AI**: AWS Bedrock (Claude Sonnet) for call analysis, AssemblyAI for transcription
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
npm run build        # Vite frontend + esbuild backend → dist/ (also copies schema.sql)
npm run start        # Production server (NODE_ENV=production node dist/index.js)
npm run check        # TypeScript type check
npm run test         # Run tests (tsx --test tests/*.test.ts)
npm run test:client  # Run client-side tests (vitest)
npm run seed         # Seed database with sample data (tsx seed.ts)
npx vite build       # Frontend-only build (useful for quick verification)
```

## Testing
- **Framework**: Node.js built-in `test` module via `tsx`
- **Location**: `tests/` directory
  - `tests/schema.test.ts` — Zod schema validation for data integrity
  - `tests/ai-provider.test.ts` — AI provider utilities (parseJsonResponse, buildAnalysisPrompt, smartTruncate)
  - `tests/auth.test.ts` — Authentication, session management, and role-based access control
  - `tests/storage.test.ts` — Storage abstraction CRUD operations (all backends)
  - `tests/postgres-storage.test.ts` — PostgresStorage integration tests (requires `DATABASE_URL`)
  - `tests/job-queue.test.ts` — Job queue integration tests (requires `DATABASE_URL`)

## Architecture

### Key Directories
```
client/src/pages/        # Route pages (25 pages — see Pages section in README)
client/src/components/   # UI components (ui/ = shadcn, ab-testing/, dashboard/, layout/, lib/, reports/, search/, tables/, transcripts/, upload/)
client/src/components/   # Also: i18n-provider.tsx, language-selector.tsx
server/db/               # PostgreSQL schema (schema.sql) and connection pool (pool.ts)
server/services/         # 20 service modules (see Services section below)
server/routes/           # Modular route files: admin, analytics, auth, calls, coaching, dashboard, employees, insights, pipeline, reports, snapshots, users, utils
server/routes.ts         # Route coordinator + batch scheduler + job queue init
server/middleware/       # rate-limit.ts (per-user rate limiting), waf.ts (application-level WAF)
client/src/lib/i18n.ts   # i18n system (English + Spanish)
server/storage.ts        # Storage abstraction (PostgreSQL, S3, or in-memory backends)
server/storage-postgres.ts # PostgreSQL IStorage implementation (~30 methods)
server/auth.ts           # Authentication middleware + session management (PostgreSQL or memory store)
shared/schema.ts         # Zod schemas shared between client/server
tests/                   # Unit tests (Node test runner)
docs/                    # disaster-recovery.md, vpc-endpoints.md
deploy/ec2/              # EC2 deployment configs (Caddyfile, systemd, user-data)
```

### Services (server/services/)
| File | Purpose |
|------|---------|
| `ai-factory.ts` | AI provider factory/selector |
| `ai-provider.ts` | AI prompt building and response parsing |
| `assemblyai.ts` | AssemblyAI client (upload, transcribe, poll) |
| `audit-log.ts` | HIPAA audit logging (stdout + PostgreSQL) |
| `aws-credentials.ts` | AWS credential provider (env vars → EC2 IMDSv2 fallback, auto-refresh) |
| `bedrock.ts` | AWS Bedrock client (SigV4 signing, Converse API) |
| `bedrock-batch.ts` | Bedrock batch inference mode (50% cost savings) |
| `call-clustering.ts` | Call clustering via Bedrock embeddings |
| `coaching-alerts.ts` | Auto-generate coaching sessions for low/high scoring calls |
| `incident-response.ts` | Formal IRP with severity, phases, escalation, action items |
| `job-queue.ts` | PostgreSQL-backed durable job queue |
| `performance-snapshots.ts` | Periodic performance snapshot generation (employee/team/company) |
| `s3.ts` | AWS S3 client (SigV4 signing, CRUD operations) |
| `scheduled-reports.ts` | Scheduled report generation (weekly/monthly) |
| `scoring-calibration.ts` | Score calibration to normalize AI scoring distribution |
| `security-monitor.ts` | Security event tracking, breach reporting, anomaly detection |
| `totp.ts` | TOTP two-factor authentication (RFC 6238) |
| `vulnerability-scanner.ts` | Automated security scans (env, deps, DB, auth) |
| `webhooks.ts` | Webhook dispatch with HMAC signing |
| `websocket.ts` | WebSocket server for real-time pipeline updates |

### Audio Processing Pipeline (server/routes.ts → processAudioFile)
1. Archive audio to S3 immediately on upload (before queuing)
2. Enqueue job in PostgreSQL job queue (falls back to in-memory TaskQueue if no DB)
3. Job worker reads audio from S3 and sends to AssemblyAI for transcription
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
| POST | `/api/calls/bulk-reanalyze` | admin | Bulk re-analysis of calls |
| GET | `/api/calls/:id/annotations` | authenticated | Get call annotations |
| POST | `/api/calls/:id/annotations` | manager+ | Create annotation on a call |
| DELETE | `/api/calls/:id/annotations/:annotationId` | manager+ | Delete annotation |

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
| GET | `/api/my-performance` | authenticated | Current user's own performance metrics |
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
| GET | `/api/analytics/compare` | authenticated | Agent comparison (side-by-side metrics) |
| GET | `/api/analytics/clusters` | authenticated | Call clustering analysis (Bedrock embeddings) |
| GET | `/api/analytics/heatmap` | authenticated | Heatmap calendar data (call volume/scores by day) |
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
| GET | `/api/admin/webhooks` | admin | List all webhook configurations |
| POST | `/api/admin/webhooks` | admin | Create webhook (URL, events, secret for HMAC) |
| PATCH | `/api/admin/webhooks/:id` | admin | Update webhook |
| DELETE | `/api/admin/webhooks/:id` | admin | Delete webhook |
| POST | `/api/admin/webhooks/:id/test` | admin | Test webhook delivery |

### Scheduled Reports (manager+)
| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/admin/reports` | manager+ | List scheduled reports |
| GET | `/api/admin/reports/:id` | manager+ | Get scheduled report details |
| POST | `/api/admin/reports/generate` | manager+ | Generate a report |

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

# Scoring Calibration (optional — normalizes AI scoring distribution)
SCORE_CALIBRATION_ENABLED       # Set to "true" to enable (default: disabled)
SCORE_CALIBRATION_CENTER        # Desired mean score (default: 5.5)
SCORE_CALIBRATION_SPREAD        # Distribution width (default: 1.2)
SCORE_AI_MODEL_MEAN             # AI model baseline mean (default: 7.0)
SCORE_LOW_THRESHOLD             # Low score threshold for coaching alerts (default: 4.0)
SCORE_HIGH_THRESHOLD            # High score threshold for recognition (default: 9.0)

# Embeddings (for call clustering)
BEDROCK_EMBEDDING_MODEL         # Bedrock embedding model ID (for call clustering feature)

# Optional
PORT                            # Default: 5000
RETENTION_DAYS                  # Auto-purge calls older than N days (default: 90)
JOB_CONCURRENCY                 # Max parallel audio processing jobs (default: 5, requires DATABASE_URL)
JOB_POLL_INTERVAL_MS            # How often to check for new jobs (default: 5000, requires DATABASE_URL)
DB_SSL_REJECT_UNAUTHORIZED      # Set to "false" to disable SSL cert verification for PostgreSQL (not recommended)
DISABLE_SECURE_COOKIE           # Set to "true" to disable secure cookies (for non-HTTPS dev environments)
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
| **MFA (TOTP)** | `server/services/totp.ts` | Optional TOTP two-factor authentication (RFC 6238); enforced via `REQUIRE_MFA=true` |
| **Password complexity** | `server/auth.ts` | Warns on weak passwords (12+ chars, uppercase, lowercase, digit, special char) |
| **Breach notification** | `server/services/security-monitor.ts` | HIPAA §164.408 breach reporting with timeline tracking, notification status |
| **Security monitoring** | `server/services/security-monitor.ts` | Detects distributed brute-force, credential stuffing, bulk data exfiltration |
| **Read rate limiting** | `server/index.ts` | 60 req/min on data endpoints; 5 req/min on exports (prevents bulk exfiltration) |
| **WAF** | `server/middleware/waf.ts` | Application-level firewall: SQL injection, XSS, path traversal detection; IP blocklist with anomaly scoring; suspicious bot blocking |
| **Vulnerability scanning** | `server/services/vulnerability-scanner.ts` | Automated daily scans of env config, dependencies, database, auth; admin can trigger manual scans |
| **Incident response** | `server/services/incident-response.ts` | Formal IRP with severity classification, phase tracking, escalation contacts, response procedures, action items |
| **Disaster recovery** | `docs/disaster-recovery.md` | DR plan: S3 CRR, RDS cross-region replica, AMI snapshots, Route 53 DNS failover |

## Key Design Decisions
- **No AWS SDK**: Both S3 and Bedrock use raw REST APIs with manual SigV4 signing — reduces bundle size and avoids SDK dependency overhead, but means signing logic must be maintained manually
- **Dotenv**: `server/index.ts` imports `"dotenv/config"` at the top to load `.env` file. This is critical for production (pm2 does not source `.env` natively).
- **AWS credential resolution**: `aws-credentials.ts` resolves creds in order: (1) env vars (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`), (2) EC2 IMDSv2 instance profile. Credentials from env vars are **trimmed** to prevent SigV4 signing failures from trailing whitespace.
- **Hybrid storage**: PostgreSQL for structured metadata (fast queries, JOINs, transactions) + S3 for audio blobs (cheap, durable). Falls back gracefully without DATABASE_URL.
- **Durable job queue**: PostgreSQL-backed with `SELECT ... FOR UPDATE SKIP LOCKED` — survives restarts, supports concurrent workers, auto-retry with dead-letter
- **Custom prompt templates**: Per-call-category evaluation criteria, required phrases, scoring weights
- **Scoring calibration**: Optional system (`scoring-calibration.ts`) to normalize AI scores that tend to cluster high (around 7.0). Configurable via env vars.
- **Dark mode**: Toggle in settings; chart text fixed via global CSS in index.css (.dark .recharts-*)
- **Hooks ordering**: All React hooks in transcript-viewer.tsx MUST be called before early returns (isLoading/!call guards)
- **A/B test isolation**: Test calls stored under `ab-tests/` S3 prefix, completely separate from production `calls/`, `analyses/`, etc. — no risk of contaminating metrics
- **Modular routes**: All routes split into `server/routes/` modules (admin, analytics, auth, calls, coaching, dashboard, employees, insights, pipeline, reports, snapshots, users) — `server/routes.ts` is the coordinator that registers them all

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
nano .env                   # Edit the file
pm2 restart all             # Restart to pick up changes (dotenv/config reloads .env on startup)
pm2 logs --lines 20         # Verify startup — look for:
                            #   [STORAGE] Using S3 (bucket: ums-call-archive)
                            #   NOT: "S3 authentication not configured"
```
**Note**: The app loads `.env` via `dotenv/config` import at startup, so `pm2 restart all` will pick up `.env` changes. If for some reason env vars aren't updating, use `pm2 delete all && pm2 start dist/index.js --name callanalyzer && pm2 save`.

### VPC Endpoints (Recommended)
S3 and Bedrock traffic can be routed through AWS's private network instead of the public internet using VPC endpoints. This improves HIPAA posture by eliminating internet traversal for PHI. The S3 Gateway endpoint is free. No application code changes required. See [`docs/vpc-endpoints.md`](docs/vpc-endpoints.md) for setup instructions.

### GitHub Actions CI/CD
Pushes to `main` automatically trigger the Deploy workflow (`.github/workflows/deploy.yml`), which SSHs into EC2 and runs `deploy.sh`. Required GitHub Secrets: `EC2_SSH_KEY`, `EC2_HOST`, `EC2_USER`, `EC2_APP_DIR`. Can also be triggered manually via `workflow_dispatch`.

Additional workflows:
- `.github/workflows/error-monitor.yml` — Error monitoring
- `.github/workflows/view-logs.yml` — Log viewing

A `deploy-rollback.sh` script is available for reverting to a previous build.

#### AWS Credential Rotation on EC2
When IAM keys are rotated (shared across CallAnalyzer, RAG Tool, PMD Questionnaire):
1. Update `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env`
2. **Ensure no trailing whitespace** in credential values (the app trims them, but best practice)
3. `pm2 restart all`
4. Verify with `pm2 logs --lines 20` — confirm S3 and Bedrock initialize without errors
5. **Remember**: Update credentials on ALL services using this IAM user

**Alternative**: Attach an IAM instance profile to the EC2 instance to avoid managing keys entirely. The app auto-detects EC2 IMDSv2 credentials via `aws-credentials.ts` and refreshes them before expiry.

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

## Common Gotchas
- **AWS credential whitespace**: Trailing spaces/newlines in `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` cause `SignatureDoesNotMatch` errors. The app trims them automatically via `aws-credentials.ts`, but keep `.env` clean.
- **dotenv is required**: `server/index.ts` imports `"dotenv/config"` — without it, `.env` vars aren't loaded and AWS/DB connections fail
- Bedrock AI responses may contain objects where strings are expected — always use `toDisplayString()` on frontend and `normalizeStringArray()` on server when rendering/storing AI data
- The same IAM user is shared across 3 projects (CallAnalyzer, RAG Tool, PMD Questionnaire) — IAM policy covers S3, Bedrock, and Textract
- **EC2 IMDSv2**: If using an EC2 instance profile instead of env var keys, `aws-credentials.ts` handles token refresh automatically (5 min before expiry)
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- The `useQuery` key format is `["/api/calls", callId]` — TanStack Query uses the key for caching
- In-memory storage backend loses all data on restart — only use for local development without cloud credentials
- Without `DATABASE_URL`, sessions use memorystore (lost on restart) and job queue falls back to in-memory TaskQueue (no retry on crash)
- PostgreSQL schema auto-initializes on startup (`server/db/pool.ts:initializeDatabase`) — no manual migration step needed
- AssemblyAI costs: $0.15/hr base + $0.02/hr sentiment = $0.17/hr ($0.0000472/sec)
- AssemblyAI uses `speech_models: ["universal-3-pro", "universal-2"]` — Universal-3 Pro is the highest accuracy model with fallback to Universal-2 for unsupported languages
- Bedrock Batch Mode (`BEDROCK_BATCH_MODE=true`) saves 50% on AI analysis costs but results are delayed (up to 24 hours). Calls show as "awaiting_analysis" until batch completes.
- **Scoring calibration**: AI models tend to score calls around 7.0. Enable `SCORE_CALIBRATION_ENABLED=true` to normalize the distribution.
- **Coaching alerts**: Calls scoring ≤4 or ≥9 automatically trigger coaching session creation via `coaching-alerts.ts`
