# CallAnalyzer

AI-powered call quality analysis platform built for UMS (a medical supply company). Agents upload call recordings, which are automatically transcribed and analyzed for performance scoring, compliance, sentiment, and coaching insights. The platform is designed to be HIPAA-compliant.

**Live at**: `umscallanalyzer.com`

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [How It Works](#how-it-works)
3. [Tech Stack](#tech-stack)
4. [Features by Role](#features-by-role)
5. [Pages and Navigation](#pages-and-navigation)
6. [Audio Processing Pipeline](#audio-processing-pipeline)
7. [AI Analysis Details](#ai-analysis-details)
8. [A/B Model Testing](#ab-model-testing)
9. [Gamification](#gamification)
10. [Data Storage](#data-storage)
11. [Authentication and Security](#authentication-and-security)
12. [HIPAA Compliance](#hipaa-compliance)
13. [API Reference](#api-reference)
14. [Project Structure](#project-structure)
15. [Environment Variables](#environment-variables)
16. [Local Development](#local-development)
17. [Deployment](#deployment)
18. [Maintenance](#maintenance)

---

## What It Does

CallAnalyzer solves a specific problem: UMS has call center agents making and receiving calls related to medical supply orders, insurance verification, and patient communication. Management needs to evaluate call quality, identify training needs, ensure HIPAA compliance, and track agent performance over time.

Before CallAnalyzer, this required manual listening and subjective scoring. Now, managers upload call recordings and the system automatically:

- **Transcribes** the call using AssemblyAI (speech-to-text with speaker detection)
- **Analyzes** the transcript using AWS Bedrock (Claude AI) for performance scoring
- **Scores** the agent on compliance, customer experience, communication, and resolution (each 0-10)
- **Detects sentiment** throughout the call (positive, neutral, negative)
- **Identifies topics** discussed (e.g., "order tracking", "billing dispute", "Medicare enrollment")
- **Generates coaching feedback** with specific strengths and improvement suggestions with timestamps
- **Flags issues** automatically (low scores, agent misconduct, missing required phrases, Medicare calls)
- **Auto-assigns** calls to the correct employee by detecting the agent's name in the transcript
- **Tracks trends** across agents, teams, and time periods via dashboards and reports

---

## How It Works

The core flow is:

1. A user (any authenticated role) uploads an audio file via the Upload page
2. The server sends the audio to AssemblyAI for transcription and archives it to S3
3. Once transcription completes, the server sends the transcript to AWS Bedrock (Claude Sonnet) with a detailed prompt
4. Claude returns a structured JSON analysis: scores, summary, topics, sentiment, feedback, flags
5. The server normalizes the results, computes confidence scores, and stores everything in S3
6. The frontend updates in real-time via WebSocket as each step completes
7. The call appears on the dashboard and in reports, contributing to employee metrics

The entire pipeline runs asynchronously. The upload API returns immediately with a call ID, and the processing happens in the background. WebSocket messages notify the frontend of progress (`uploading → transcribing → analyzing → processing → saving → completed`).

---

## Tech Stack

### Frontend
- **React 18** with TypeScript — single-page app
- **Vite** — build tool and dev server with hot module replacement
- **TailwindCSS** — utility-first CSS framework
- **shadcn/ui** — component library built on Radix UI primitives (cards, dialogs, tables, tabs, selects, etc.)
- **Recharts** — charting library for dashboards (area charts, pie charts, bar charts)
- **Wouter** — lightweight React router (simpler alternative to React Router)
- **TanStack Query** — server state management with caching, refetching, and optimistic updates
- **Framer Motion** — page transition animations
- **Lucide React** — icon library

### Backend
- **Express.js** with TypeScript (ESM modules)
- **Node.js** built-in test runner via `tsx` for unit tests
- **Multer** — file upload handling
- **Passport.js** — authentication middleware with local strategy
- **Zod** — schema validation shared between client and server
- **csv-parser** — for bulk employee CSV imports

### AI Services
- **AssemblyAI** — audio transcription with word-level timing, speaker detection, and confidence scores
- **AWS Bedrock** — Claude Sonnet for call analysis. Uses the Converse API with raw `fetch` + AWS SigV4 signing (no AWS SDK)

### Infrastructure
- **AWS RDS PostgreSQL** — metadata, sessions, job queue, HIPAA audit log (recommended for production)
- **AWS S3** — audio blob storage (with PostgreSQL) or all data as JSON (legacy S3-only mode)
- **AWS KMS** — S3 server-side encryption
- **Caddy** — reverse proxy with automatic TLS (Let's Encrypt) on EC2
- **pm2** — process manager on EC2 (auto-restart, log management)
- **EC2** — primary production hosting

---

## Features by Role

CallAnalyzer has three user roles with increasing permissions:

### Viewer (read-only)
- View the dashboard with call metrics, sentiment distribution, performance trends, and flagged calls
- Browse and search all transcripts with full-text search
- Play back call audio with speed controls (0.5x to 2x)
- View interactive transcripts with word-level timing highlights and topic markers
- View sentiment analysis per segment of each call
- View performance metrics and reports across agents and teams
- View coaching sessions assigned to employees
- View aggregate insights and trends

### Manager (everything a viewer can do, plus)
- Upload call recordings for analysis
- Assign calls to specific employees (or reassign)
- Edit AI-generated analysis scores and summaries (with audit trail — must provide a reason)
- Create and manage employee records
- Create coaching sessions with action plans for employees
- Delete calls
- Export report data

### Admin (everything a manager can do, plus)
- Approve or deny access requests from new users
- Bulk import employees via CSV upload
- Create, edit, and delete custom prompt templates (per call category)
- A/B model testing — compare different Bedrock models on the same call
- Spend tracking — monitor estimated API costs by period, service, and user
- System configuration

Users are defined via the `AUTH_USERS` environment variable (format: `username:password:role:displayName`). New users can submit an access request through the login page, which an admin must approve.

---

## Pages and Navigation

The app has a sidebar navigation that adapts based on user role:

| Page | Path | Description |
|------|------|-------------|
| **Dashboard** | `/` | Overview: total calls, avg performance, sentiment distribution, 30-day trend charts, flagged calls, top performers |
| **Upload Calls** | `/upload` | Drag-and-drop audio upload with employee assignment and call category selection |
| **Transcripts** | `/transcripts` | Paginated, filterable table of all calls. Click to open detailed transcript viewer |
| **Transcript Viewer** | `/transcripts/:id` | Full call detail: audio player, interactive transcript, sentiment timeline, AI analysis, score editing |
| **Search** | `/search` | Full-text search across all transcripts |
| **Sentiment** | `/sentiment` | Sentiment analysis dashboard with distribution charts and per-call sentiment details |
| **Performance** | `/performance` | Agent performance metrics with rankings and comparisons |
| **Reports** | `/reports` | Filterable reports by date range and employee, with detailed agent profiles |
| **Insights** | `/insights` | Aggregate trends, common topics, recurring strengths/weaknesses across the team |
| **Employees** | `/employees` | Employee directory with add/edit. Sub-team assignment for Power Mobility teams |
| **Coaching** | `/coaching` | Coaching session management with action plans, linked to specific calls |
| **Administration** | `/admin` | Access request management (admin only) |
| **Prompt Templates** | `/admin/templates` | Custom AI prompt configuration per call category (admin only) |
| **Model Testing** | `/admin/ab-testing` | A/B model comparison tool (admin only) |
| **Spend Tracking** | `/admin/spend` | Estimated API cost tracking with charts (admin only) |
| **Leaderboard** | `/leaderboard` | Agent rankings by points, streaks, and badges with period filtering |
| **Agent Scorecard** | `/scorecard/:id` | Detailed agent profile with gamification stats (badges, points, streak) |

Keyboard shortcuts: `D` (Dashboard), `K` (Search), `N` (Upload), `R` (Reports), `?` (Help)

---

## Audio Processing Pipeline

When a call recording is uploaded, the server runs this async pipeline:

### Step 1: Archive
The audio file is uploaded to S3 under `audio/{callId}/{originalName}`. This is non-blocking — if S3 upload fails, processing continues with a warning.

### Step 2: Transcription
The audio is sent to AssemblyAI's API. The server uploads the raw audio, then submits a transcription request and polls for completion. AssemblyAI returns:
- Full transcript text
- Word-level timestamps with confidence scores
- Speaker labels (speaker A, speaker B)
- Overall confidence score

### Step 3: Prompt Template Loading
If the call has a category (inbound, outbound, internal, vendor), the server loads any custom prompt template for that category. Templates allow admins to customize:
- Evaluation criteria
- Required phrases (e.g., "Thank you for calling UMS") with severity (required vs. recommended)
- Scoring weights (e.g., compliance 40%, customer experience 30%, communication 20%, resolution 10%)
- Additional instructions

### Step 4: AI Analysis
The transcript is sent to AWS Bedrock (Claude Sonnet) with a detailed prompt. The prompt includes:
- The full transcript (or a smart-truncated version for very long calls)
- Call category context
- Evaluation criteria (custom or default)
- Required output format (strict JSON schema)

Claude returns a JSON object with: summary, topics, sentiment, performance scores, sub-scores, action items, feedback (strengths and suggestions with timestamps), flags, detected agent name, and call party type.

### Step 5: Result Processing
The server normalizes AI output (handles objects where strings are expected), computes a confidence score based on:
- Transcript confidence (40% weight)
- Word count adequacy — calls under 50 words are low confidence (20% weight)
- Call duration — calls under 30 seconds are low confidence (15% weight)
- Whether AI analysis completed successfully (25% weight)

Flags are set: `low_score` (performance <= 2.0), `exceptional_call` (>= 9.0), `agent_misconduct:description`, `low_confidence` (< 0.7), `missing_required_phrase:label`, `medicare_call`.

### Step 6: Storage
Transcript, sentiment analysis, and call analysis are stored as separate JSON files in S3. The call status is updated to "completed".

### Step 7: Auto-Assignment
If no employee was specified at upload and the AI detected an agent name, the system tries to match it against the employee directory (by first name, last name, or full name) and auto-assigns.

### On Failure
The call is marked as "failed", the WebSocket notifies the client, and the uploaded file is cleaned up. Error messages are logged without full stack traces (HIPAA — avoids logging PHI). There is no automatic retry — users re-upload manually.

---

## AI Analysis Details

### What Claude Analyzes
The AI evaluates each call on four sub-scores (0-10 each):
- **Compliance**: Following procedures, HIPAA protocols, company policies
- **Customer Experience**: Empathy, patience, tone, rapport building
- **Communication**: Clarity, active listening, completeness of information
- **Resolution**: Effectiveness of issue resolution, follow-through

These combine into an overall performance score (0-10). The AI also:
- Writes a natural-language summary of the call
- Identifies specific topics discussed
- Classifies overall sentiment (positive/neutral/negative with a 0-1 score)
- Generates 2-4 concrete, actionable action items
- Lists strengths and suggestions with timestamps (e.g., "At 02:15, the agent demonstrated strong empathy...")
- Detects the agent's name if stated during the call
- Classifies the call party type (customer, insurance, medical facility, Medicare, vendor, internal)

### Custom Prompt Templates
Admins can create per-category prompt templates that customize:
- What criteria to evaluate (e.g., for Medicare calls, emphasize compliance; for internal calls, evaluate collaboration)
- Required phrases with labels and severity levels
- Scoring weights (how much each sub-score contributes to the overall score)
- Additional instructions (e.g., "Flag any mention of patient names without proper verification")

### Manual Edit Audit Trail
Managers can override AI-generated scores and summaries. Every edit requires a reason and is stored in an audit trail with: who edited, when, what changed, and why. The original AI values are preserved.

---

## A/B Model Testing

Admin-only feature for comparing Bedrock models to optimize cost vs. quality.

### How It Works
1. Admin uploads a test audio file and selects a comparison model (e.g., Haiku vs. Sonnet)
2. The system transcribes once (saving AssemblyAI cost), then runs analysis with both models in parallel
3. Results are displayed side-by-side: overall score, sub-scores, sentiment, summary, topics, strengths, suggestions, latency
4. Score difference indicators show where models agree or diverge

### Key Properties
- Test calls are stored under a separate `ab-tests/` S3 prefix
- They are **never** included in dashboard metrics, employee performance, or reports
- No employee assignment occurs on test calls
- Each test tracks latency per model (for cost/speed tradeoff analysis)

### Available Model Presets
- Claude Sonnet 4.6 (current production default) — `$$`
- Claude Sonnet 4 — `$$`
- Claude Haiku 4.5 — `$`
- Claude 3 Haiku (cheapest) — `$`
- Claude 3.5 Sonnet v2 — `$$`
- Custom model ID (any valid Bedrock model identifier)

---

## Spend Tracking

Admin-only feature to monitor estimated API costs. Every call analysis and A/B test automatically records a usage entry with estimated costs.

### Cost Estimation
- **AssemblyAI**: ~$0.17/hr of audio ($0.15/hr base + $0.02/hr sentiment = $0.0000472/sec)
- **AWS Bedrock**: Per-model token pricing (input + output tokens). Sonnet ~$3/M input, $15/M output; Haiku ~$1/M input, $5/M output

### Dashboard Views
- **Current Month**: Spend so far this month
- **Last Month**: Previous month's total
- **Year to Date**: Cumulative spend for the year
- **All Time**: Complete history

Each view shows: total estimated cost, calls processed, average cost per call, daily spend chart, cost breakdown by service (AssemblyAI vs Bedrock), and cost by user.

### How It Works
1. After each successful call analysis, a `UsageRecord` is saved to `usage/{id}.json` in S3
2. The record includes: estimated AssemblyAI cost (from audio duration), estimated Bedrock cost (from transcript token count), user who uploaded, and type (call vs A/B test)
3. A/B tests track costs for both models separately
4. All costs are estimates — actual AWS/AssemblyAI billing may vary slightly

---

## Gamification

CallAnalyzer includes a gamification system to encourage agent performance through friendly competition.

### Badges (12 types)
- **Milestone**: First Call, Quarter Century (25), Half Century (50), Century Club (100)
- **Score**: Perfect 10 (scored 10/10 on a call)
- **Streak**: Hat Trick (3), On Fire (5), Unstoppable (10) — consecutive calls scoring 8+
- **Sub-score**: Compliance Star, Empathy Champion, Resolution Ace — sub-score 9+ on 5 consecutive calls
- **Improvement**: Most Improved — biggest score gain over 30 days

### Points
Points are computed per call: base 10 + score bonus (score × 10) + streak multiplier (1.5× if streak ≥ 3) + badge bonus (50 per new badge). Points accumulate and are displayed on the leaderboard and agent scorecard.

### Leaderboard
The `/leaderboard` page shows agent rankings filterable by week, month, or all time. Displays points, average score, call count, current streak, and earned badges. Top 3 agents get a podium display.

### Integration
Badge evaluation runs automatically at the end of the audio processing pipeline (non-blocking, after coaching alerts). No additional API calls or AI processing — badges are computed from existing call data in storage.

---

## Data Storage

### Storage Backend Selection (Priority Order)
1. **`DATABASE_URL` set** → **PostgresStorage** (recommended for production): Metadata in AWS RDS PostgreSQL, audio blobs in S3. Enables durable sessions, job queue with retry, HIPAA audit log table, and fast SQL queries.
2. **`S3_BUCKET` or `STORAGE_BACKEND=s3` set** → **CloudStorage** (legacy): All data stored as JSON files in S3. Simpler but no relational queries or durable job queue.
3. **Neither set** → **MemStorage** (dev only): In-memory storage, all data lost on restart.

### S3 Data Layout
When using CloudStorage (S3-only mode), each data type is stored as JSON files under a specific prefix:

| S3 Prefix | Data Type | Example Key |
|-----------|-----------|-------------|
| `employees/` | Employee records | `employees/{uuid}.json` |
| `calls/` | Call metadata (status, category, employee, upload time) | `calls/{uuid}.json` |
| `transcripts/` | Full transcript with word-level timing | `transcripts/{callId}.json` |
| `sentiments/` | Sentiment analysis (overall + per-segment) | `sentiments/{callId}.json` |
| `analyses/` | AI analysis (scores, summary, feedback, flags) | `analyses/{callId}.json` |
| `audio/` | Original audio files | `audio/{callId}/{filename}.mp3` |
| `coaching/` | Coaching sessions with action plans | `coaching/{uuid}.json` |
| `prompt-templates/` | Custom AI prompt configurations | `prompt-templates/{uuid}.json` |
| `access-requests/` | User access requests | `access-requests/{uuid}.json` |
| `ab-tests/` | A/B model comparison results | `ab-tests/{uuid}.json` |
| `usage/` | API cost tracking records | `usage/{uuid}.json` |

When using PostgresStorage, structured metadata lives in RDS tables while audio blobs remain in S3 under the `audio/` prefix.

### S3 Security
- Server-side encryption with AWS KMS (SSE-KMS with bucket keys)
- Public access is blocked (all four block settings enabled)
- Versioning enabled (protects against accidental overwrites/deletes)
- No public URLs — all access goes through the authenticated API

---

## Authentication and Security

### User Management
Users are defined via the `AUTH_USERS` environment variable:
```
AUTH_USERS=robin:password123:admin:Robin Choudhury,jane:pass456:manager:Jane Doe,viewer1:pass789:viewer:View Only
```

Format: `username:password:role:displayName` (comma-separated for multiple users).

Passwords are hashed with scrypt + salt at startup. The plaintext passwords in the env var are never stored or logged.

### Session Management
- Sessions stored in PostgreSQL via `connect-pg-simple` when `DATABASE_URL` is set (survives restarts)
- Falls back to in-memory MemoryStore without `DATABASE_URL` (lost on restart)
- 15-minute idle timeout (rolling — resets on each request)
- 8-hour absolute maximum session lifetime
- Secure cookies in production (httpOnly, sameSite=lax, secure flag)

### Access Request Flow
1. A new user visits the login page and clicks "Request Access"
2. They fill in their name, email, desired role (viewer or manager), and reason
3. An admin sees the pending request in the Administration page
4. Admin approves or denies — if approved, the admin would add the user to `AUTH_USERS` and restart

### Rate Limiting
- Login: 5 attempts per 15 minutes per IP address
- Account lockout: 5 failed login attempts → 15-minute lockout (per IP and per username)

---

## HIPAA Compliance

CallAnalyzer handles Protected Health Information (PHI) in audio recordings and transcripts. The following controls are in place:

| Category | Control | Details |
|----------|---------|---------|
| **Encryption at rest** | AWS KMS (SSE-KMS) | All S3 data encrypted with bucket keys |
| **Encryption in transit** | TLS 1.2+ via Caddy | Auto-renewed Let's Encrypt certificates |
| **Access control** | Role-based (3 tiers) | viewer < manager < admin via `requireRole()` middleware |
| **Account lockout** | 5 attempts / 15 min | Per IP and per username |
| **Session security** | 15-min idle + 8-hr max | httpOnly, sameSite, secure cookies |
| **Audit logging** | Structured JSON logs | `[HIPAA_AUDIT]` tags for all PHI access events |
| **API access logging** | All requests logged | User identity, method, path, status, duration |
| **Security headers** | CSP, HSTS, X-Frame-Options | Restricts scripts to same-origin, enables HSTS |
| **HTTPS enforcement** | HTTP → HTTPS redirect | In production mode |
| **Data retention** | Auto-purge after 90 days | Configurable via `RETENTION_DAYS` env var |
| **Error logging** | Messages only, no stacks | Prevents PHI leakage in log files |
| **File cleanup** | Temp files deleted after S3 | No PHI persists on EC2 filesystem |

### BAA Requirements
- **AWS BAA**: Covers S3, Bedrock, KMS, and CloudTrail (signed via AWS Artifact)
- **AssemblyAI BAA**: Contact AssemblyAI to establish (they offer HIPAA-compliant transcription)

### Known Limitations
- Auth users stored in environment variable (works for small teams; larger orgs should use an IdP like Cognito)
- Same IAM user shared across 3 projects (consider separate IAM users or EC2 instance profiles)
- MFA (TOTP) is available but optional by default — set `REQUIRE_MFA=true` to enforce for all users
- No WAF configured (consider AWS WAF for additional protection)
- S3/Bedrock accessed over public internet (consider VPC endpoints)

See `SECURITY.md` for the full HIPAA security summary with code location references and verification commands.

---

## API Reference

### Public (no auth required)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check — returns `{ status: "ok", timestamp }` |
| `POST` | `/api/auth/login` | Login with username/password (rate limited, supports MFA) |
| `POST` | `/api/auth/logout` | Logout and clear session |
| `GET` | `/api/auth/me` | Get current authenticated user |
| `POST` | `/api/access-requests` | Submit access request (name, email, role, reason) |

### MFA (authenticated)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/mfa/status` | Check MFA status for current user |
| `POST` | `/api/auth/mfa/setup` | Generate TOTP secret + otpauth URI |
| `POST` | `/api/auth/mfa/enable` | Verify TOTP code and enable MFA |
| `POST` | `/api/auth/mfa/disable` | Disable MFA (admin can disable for others) |
| `GET` | `/api/auth/mfa/users` | List all MFA-enabled users (admin only) |

### Authenticated (any role)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/calls` | List calls with filtering (status, sentiment, employee) and pagination |
| `GET` | `/api/calls/:id` | Get single call details |
| `POST` | `/api/calls/upload` | Upload audio file (multipart form, starts async pipeline) |
| `GET` | `/api/calls/:id/audio` | Stream audio for playback |
| `GET` | `/api/calls/:id/transcript` | Get transcript with word-level timing |
| `GET` | `/api/calls/:id/sentiment` | Get sentiment analysis (overall + segments) |
| `GET` | `/api/calls/:id/analysis` | Get AI analysis (scores, summary, feedback) |
| `GET` | `/api/calls/:id/tags` | Get tags for a call |
| `POST` | `/api/calls/:id/tags` | Add a tag to a call |
| `DELETE` | `/api/calls/:id/tags/:tagId` | Remove a tag from a call |
| `GET` | `/api/tags` | Get all unique tags (for autocomplete) |
| `GET` | `/api/calls/by-tag/:tag` | Search calls by tag |
| `GET` | `/api/employees` | List all employees |
| `GET` | `/api/dashboard/metrics` | Aggregate metrics (total calls, avg scores) |
| `GET` | `/api/dashboard/sentiment` | Sentiment distribution (positive/neutral/negative counts) |
| `GET` | `/api/dashboard/performers` | Top performers by average score |
| `GET` | `/api/search` | Full-text transcript search |
| `GET` | `/api/performance` | Performance metrics per employee |
| `GET` | `/api/reports/summary` | Summary report |
| `GET` | `/api/reports/filtered` | Filtered reports (date range, employee) |
| `GET` | `/api/reports/agent-profile/:id` | Detailed agent profile with call history |
| `POST` | `/api/reports/agent-summary/:id` | Generate AI narrative summary for an agent |
| `GET` | `/api/coaching/employee/:id` | Get coaching sessions for an employee |
| `GET` | `/api/insights` | Aggregate insights and trends |
| `GET` | `/api/analytics/teams` | Comparative team performance (sub-team aggregates) |
| `GET` | `/api/analytics/team/:teamName` | Individual employee metrics within a team |

### Manager+ (manager or admin)
| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/api/calls/:id/analysis` | Edit AI analysis (requires reason for audit trail) |
| `PATCH` | `/api/calls/:id/assign` | Assign/reassign call to employee |
| `DELETE` | `/api/calls/:id` | Delete call and all associated data |
| `POST` | `/api/employees` | Create employee |
| `PATCH` | `/api/employees/:id` | Update employee |
| `GET` | `/api/coaching` | List all coaching sessions |
| `POST` | `/api/coaching` | Create coaching session |
| `PATCH` | `/api/coaching/:id` | Update coaching session |
| `GET` | `/api/export/calls` | Export calls as CSV (with date/employee filters) |
| `GET` | `/api/export/team-analytics` | Export team analytics as CSV |

### Admin only
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/access-requests` | List all access requests |
| `PATCH` | `/api/access-requests/:id` | Approve/deny access request |
| `POST` | `/api/employees/import-csv` | Bulk import employees from CSV |
| `GET` | `/api/prompt-templates` | List prompt templates |
| `POST` | `/api/prompt-templates` | Create prompt template |
| `PATCH` | `/api/prompt-templates/:id` | Update prompt template |
| `DELETE` | `/api/prompt-templates/:id` | Delete prompt template |
| `GET` | `/api/ab-tests` | List A/B model tests |
| `GET` | `/api/ab-tests/:id` | Get A/B test details |
| `POST` | `/api/ab-tests/upload` | Start A/B model comparison |
| `DELETE` | `/api/ab-tests/:id` | Delete A/B test |
| `GET` | `/api/usage` | Get all usage/cost records |
| `GET` | `/api/admin/queue-status` | Job queue stats (pending, running, completed, failed) |
| `GET` | `/api/admin/dead-jobs` | List dead-letter jobs |
| `POST` | `/api/admin/dead-jobs/:id/retry` | Retry a dead-letter job |
| `GET` | `/api/admin/batch-status` | Bedrock batch inference status |
| `GET` | `/api/admin/security-summary` | Security posture summary |
| `GET` | `/api/admin/security-alerts` | Recent security alerts |
| `PATCH` | `/api/admin/security-alerts/:id` | Acknowledge a security alert |
| `GET` | `/api/admin/breach-reports` | List HIPAA breach reports |
| `POST` | `/api/admin/breach-reports` | File a new breach report |
| `PATCH` | `/api/admin/breach-reports/:id` | Update breach notification status |

---

## Project Structure

```
assemblyai_tool/
├── client/                         # Frontend (React + TypeScript)
│   └── src/
│       ├── pages/                  # Route pages
│       │   ├── dashboard.tsx       # Main dashboard with metrics and charts
│       │   ├── upload.tsx          # Audio file upload
│       │   ├── transcripts.tsx     # Call list + transcript viewer
│       │   ├── search.tsx          # Full-text search
│       │   ├── search-v2.tsx       # Alternative search implementation
│       │   ├── sentiment.tsx       # Sentiment analysis dashboard
│       │   ├── performance.tsx     # Performance metrics
│       │   ├── reports.tsx         # Filterable reports + agent profiles
│       │   ├── agent-scorecard.tsx # Agent performance scorecard
│       │   ├── team-analytics.tsx  # Comparative team performance
│       │   ├── insights.tsx        # Aggregate insights and trends
│       │   ├── employees.tsx       # Employee management
│       │   ├── coaching.tsx        # Coaching session management
│       │   ├── admin.tsx           # Access request management
│       │   ├── prompt-templates.tsx # Custom prompt template CRUD
│       │   ├── ab-testing.tsx      # A/B model comparison tool
│       │   ├── spend-tracking.tsx  # API cost tracking dashboard
│       │   ├── security.tsx        # Security/breach reporting dashboard
│       │   ├── auth.tsx            # Login + access request form
│       │   └── not-found.tsx       # 404 page
│       ├── components/
│       │   ├── ui/                 # shadcn/ui components (card, dialog, table, etc.)
│       │   ├── layout/sidebar.tsx  # Sidebar navigation
│       │   ├── upload/             # File upload component
│       │   ├── tables/             # Data table components
│       │   ├── transcripts/        # Transcript viewer + audio waveform
│       │   ├── dashboard/          # Dashboard sub-components
│       │   ├── search/             # Search components (call card, employee filter)
│       │   └── lib/                # Utility components (confirm dialog, error boundary)
│       ├── hooks/                  # Custom React hooks (WebSocket, toast)
│       ├── lib/                    # Utilities (queryClient, helpers)
│       └── App.tsx                 # Root component with routing
├── server/                         # Backend (Express + TypeScript)
│   ├── index.ts                    # Server entry point (middleware, security headers, retention)
│   ├── routes.ts                   # All API routes + audio processing pipeline
│   ├── storage.ts                  # Storage abstraction (MemStorage + CloudStorage)
│   ├── storage-postgres.ts         # PostgreSQL IStorage implementation (~30 methods)
│   ├── auth.ts                     # Authentication (passport, sessions, role middleware)
│   ├── vite.ts                     # Vite dev server integration
│   ├── db/
│   │   ├── schema.sql              # PostgreSQL schema definition
│   │   └── pool.ts                 # Database connection pool + auto-init
│   └── services/
│       ├── bedrock.ts              # AWS Bedrock client (SigV4 signing, Converse API)
│       ├── bedrock-batch.ts        # Bedrock batch inference mode (50% cost savings)
│       ├── ai-provider.ts          # AI prompt building and response parsing
│       ├── ai-factory.ts           # AI provider factory/selector
│       ├── assemblyai.ts           # AssemblyAI client (upload, transcribe, poll)
│       ├── s3.ts                   # AWS S3 client (SigV4 signing, CRUD operations)
│       ├── websocket.ts            # WebSocket server for real-time updates
│       ├── audit-log.ts            # HIPAA audit logging (stdout + PostgreSQL)
│       ├── job-queue.ts            # PostgreSQL-backed durable job queue
│       ├── totp.ts                 # TOTP two-factor authentication (RFC 6238)
│       └── security-monitor.ts     # Security event tracking and breach reporting
├── shared/
│   └── schema.ts                   # Zod schemas shared between client and server
├── tests/
│   ├── schema.test.ts              # Schema validation tests
│   ├── ai-provider.test.ts         # AI provider utility tests
│   ├── auth.test.ts                # Authentication + role-based access tests
│   ├── storage.test.ts             # Storage abstraction CRUD tests
│   ├── postgres-storage.test.ts    # PostgreSQL integration tests (requires DATABASE_URL)
│   └── job-queue.test.ts           # Job queue integration tests (requires DATABASE_URL)
├── deploy/
│   └── ec2/                        # EC2 deployment configs (Caddyfile, systemd, user-data)
├── .github/
│   └── workflows/
│       ├── deploy.yml              # Auto-deploy to EC2 on push to main
│       ├── error-monitor.yml       # Error monitoring workflow
│       └── view-logs.yml           # Log viewing workflow
├── deploy.sh                       # EC2 deploy script (pull, build, restart)
├── deploy-rollback.sh              # Rollback to previous build
├── CLAUDE.md                       # Development reference (for AI assistants)
├── SECURITY.md                     # HIPAA security summary
└── package.json                    # Dependencies and scripts
```

---

## Environment Variables

```bash
# === Required ===
ASSEMBLYAI_API_KEY              # AssemblyAI API key for transcription
SESSION_SECRET                  # Secret for signing session cookies

# === Authentication ===
AUTH_USERS                      # Format: user:pass:role:name,user2:pass2:role2:name2
                                # Roles: viewer, manager, admin

# === AWS (for Bedrock AI + S3 storage) ===
AWS_ACCESS_KEY_ID               # IAM user access key
AWS_SECRET_ACCESS_KEY           # IAM user secret key
AWS_REGION                      # Default: us-east-1
AWS_SESSION_TOKEN               # Optional: for temporary credentials / IAM roles

# === Database (recommended for production) ===
DATABASE_URL                    # postgresql://user:password@host:5432/dbname
                                # Enables: PostgresStorage, durable sessions, job queue, audit log

# === Storage ===
S3_BUCKET                       # S3 bucket name (default: ums-call-archive)
                                # Without DATABASE_URL or S3_BUCKET, falls back to in-memory storage

# === AI Model ===
BEDROCK_MODEL                   # Bedrock model ID (default: us.anthropic.claude-sonnet-4-6)

# === Batch Inference (50% cost savings, delayed results) ===
BEDROCK_BATCH_MODE              # Set to "true" to enable batch inference (default: disabled)
BEDROCK_BATCH_ROLE_ARN          # IAM role ARN for Bedrock batch jobs (required if batch mode enabled)
BATCH_INTERVAL_MINUTES          # How often to submit/check batch jobs (default: 15)
BATCH_SCHEDULE_START            # Time-of-day to START batch mode (24h format, e.g. "18:00")
BATCH_SCHEDULE_END              # Time-of-day to STOP batch mode (24h format, e.g. "08:00")

# === MFA (Two-Factor Authentication) ===
REQUIRE_MFA                     # Set to "true" to enforce TOTP MFA for all users (default: disabled)

# === Optional ===
PORT                            # Server port (default: 5000)
RETENTION_DAYS                  # Auto-purge calls older than N days (default: 90)
JOB_CONCURRENCY                 # Max parallel audio processing jobs (default: 5, requires DATABASE_URL)
JOB_POLL_INTERVAL_MS            # How often to check for new jobs (default: 5000, requires DATABASE_URL)
```

---

## Local Development

### Prerequisites
- Node.js 18+
- npm
- AssemblyAI API key (required for transcription)
- AWS credentials (required for S3 storage and Bedrock AI; without them, uses in-memory storage and skips AI analysis)

### Setup
```bash
git clone <repo-url>
cd assemblyai_tool
npm install

# Create .env file with at least:
# ASSEMBLYAI_API_KEY=your_key
# SESSION_SECRET=any_random_string
# AUTH_USERS=admin:password:admin:Admin User

npm run dev    # Starts on http://localhost:5000 with Vite HMR
```

### Commands
```bash
npm run dev          # Dev server with hot reload (tsx watch + Vite HMR)
npm run build        # Production build (Vite frontend → dist/client/, esbuild backend → dist/index.js)
npm run start        # Production server (NODE_ENV=production)
npm run check        # TypeScript type check
npm run test         # Run unit tests (Node.js test runner via tsx)
```

---

## Deployment

### EC2 (Primary — Production)
The production deployment runs on an Amazon Linux EC2 instance with pm2 and Caddy, backed by AWS RDS PostgreSQL and S3:

**Quick deploy:**
```bash
ssh -i your-key.pem ec2-user@<ec2-ip>
cd ~/assemblyai_tool
./deploy.sh          # Pulls main, installs, builds, restarts pm2
```

**Manual deploy:**
```bash
cd ~/assemblyai_tool
git pull origin main
npm install
npm run build
pm2 restart all
pm2 logs --lines 20  # Verify startup
```

**EC2 Instance Connect** is also available (no SSH key needed) via the AWS Console "Connect" button.

### Architecture on EC2
```
Internet → Caddy (port 443, auto-TLS) → Node.js (port 5000) → S3, AssemblyAI, Bedrock
```
Caddy handles TLS termination with Let's Encrypt certificates for `umscallanalyzer.com`.

### GitHub Actions CI/CD
Pushes to `main` automatically deploy to EC2 via the `.github/workflows/deploy.yml` workflow. It SSHs into EC2 and runs `deploy.sh`. Can also be triggered manually from the GitHub Actions UI.

Required GitHub Secrets: `EC2_SSH_KEY`, `EC2_HOST`, `EC2_USER`, `EC2_APP_DIR`.

Additional workflows: `error-monitor.yml` (error monitoring), `view-logs.yml` (log viewing).

### Render.com (Deprecated)
Render.com was previously used for testing. All hosting is now on EC2 with RDS PostgreSQL.

---

## Maintenance

### Regular Tasks
| Task | Frequency | How |
|------|-----------|-----|
| **IAM key rotation** | Every 90 days | Update `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env`, restart pm2. Same IAM user is shared across CallAnalyzer, RAG Tool, PMD Questionnaire |
| **Node.js security patches** | Monthly | `node -v`, update via nvm or yum |
| **npm dependency audit** | Monthly | `npm audit`, `npm update`, rebuild and deploy |
| **OS patching (EC2)** | Monthly | `sudo yum update --security` |
| **Log review** | Weekly/monthly | `pm2 logs callanalyzer --lines 100`, check for errors |
| **SSL certificate** | Automatic | Caddy auto-renews Let's Encrypt certificates |
| **Data retention** | Automatic | Calls older than `RETENTION_DAYS` (default 90) auto-purge on startup and every 24 hours |

### Updating Environment Variables on EC2
```bash
nano .env                   # Edit the variable
pm2 restart all             # Restart to pick up changes
pm2 logs --lines 20         # Verify — look for:
                            #   [STORAGE] Using S3 (bucket: ums-call-archive)
                            #   Bedrock provider initialized (region: us-east-1, model: ...)
```

### Changing the AI Model
To switch the production AI model (e.g., from Sonnet to Haiku for cost savings):
1. Use the A/B Model Testing feature first to compare quality
2. Update `BEDROCK_MODEL` in `.env` to the new model ID
3. Restart: `pm2 restart all`

### Troubleshooting
- **"S3 authentication not configured"** in logs → Check `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env`
- **Calls stuck in "processing"** → Check `pm2 logs --err` for AssemblyAI or Bedrock errors
- **Login not working** → Verify `AUTH_USERS` format: `user:pass:role:name`
- **Empty dashboard** → Verify S3 bucket has data; in-memory storage loses data on restart

---

## Planned Integration: RAG Knowledge Base

CallAnalyzer will integrate with the **ums-knowledge-reference** repository to ground AI analysis in company-specific documentation (SOPs, compliance guides, product catalogs, required scripts).

### How It Will Work
1. The `ums-knowledge-reference` repo provides a standalone RAG service (document ingestion, chunking, embedding, vector search)
2. During call analysis, CallAnalyzer will query the RAG service for relevant company policies and procedures based on the call transcript
3. Retrieved context is injected into the Bedrock AI prompt, improving scoring accuracy against actual company standards
4. Coaching recommendations will reference specific company training materials

### Configuration
- `RAG_SERVICE_URL` — URL of the knowledge reference API
- `RAG_ENABLED=true` — toggle to enable RAG context injection
- Graceful fallback: if the RAG service is unavailable, analysis proceeds without additional context (current behavior)
