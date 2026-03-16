# CallAnalyzer — AI-Powered Call Quality Analysis Platform

## Project Overview
HIPAA-compliant call analysis tool for a medical supply company (UMS). Agents upload call recordings, which are transcribed by AssemblyAI and analyzed by AWS Bedrock (Claude) for performance scoring, compliance, sentiment, and coaching insights.

## Tech Stack
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts, Wouter (routing), TanStack Query
- **Backend**: Express.js + TypeScript (ESM), runs on Node
- **AI**: AWS Bedrock (Claude Sonnet) for call analysis, AssemblyAI for transcription
- **Storage**: AWS S3 (`ums-call-archive` bucket) — employees, calls, transcripts, analyses, audio, coaching, prompt templates, A/B tests
- **Auth**: Session-based with bcrypt, role-based (viewer/manager/admin)
- **Hosting**: Render.com (primary), EC2 with pm2 + Caddy (secondary)

## Local Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (see `.env.example`):
   - **Required**: `ASSEMBLYAI_API_KEY`, `SESSION_SECRET`
   - **Auth users**: `AUTH_USERS` — format: `username:password:role:displayName` (comma-separated for multiple)
   - **AWS (for Bedrock + S3)**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
   - **Storage**: `S3_BUCKET` — without this, falls back to **in-memory storage (data lost on restart)**

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
npm run test         # Run tests (tsx --test tests/*.test.ts)
npx vite build       # Frontend-only build (useful for quick verification)
```

## Testing
- **Framework**: Node.js built-in `test` module via `tsx`
- **Location**: `tests/` directory
  - `tests/schema.test.ts` — Zod schema validation for data integrity
  - `tests/ai-provider.test.ts` — AI provider utilities (parseJsonResponse, buildAnalysisPrompt, smartTruncate)

## Architecture

### Key Directories
```
client/src/pages/        # Route pages (dashboard, transcripts, employees, etc.)
client/src/components/   # UI components (ui/ = shadcn, tables/, transcripts/, dashboard/)
server/services/         # AI provider (Bedrock), S3 client, AssemblyAI, WebSocket
server/routes.ts         # All API routes + audio processing pipeline
server/storage.ts        # Storage abstraction (memory or S3 backends)
server/auth.ts           # Authentication middleware + session management
shared/schema.ts         # Zod schemas shared between client/server
tests/                   # Unit tests (Node test runner)
```

### Audio Processing Pipeline (server/routes.ts → processAudioFile)
1. Upload audio to S3 (archive failure is non-blocking — continues with warning)
2. Send to AssemblyAI for transcription (with polling; throws if polling fails/incomplete)
3. Load custom prompt template by call category (falls back to default if template fails)
4. Send transcript to Bedrock for AI analysis (falls back to transcript-based defaults if Bedrock fails)
5. Process results: normalize data, compute confidence scores, detect agent name, set flags
6. Store transcript, sentiment, and analysis to S3
7. Auto-assign call to employee if agent name detected

**On failure**: Call status set to "failed", WebSocket notifies client, uploaded file cleaned up. Error messages are logged without full stack traces (HIPAA — avoids logging PHI). No automatic retry — users re-upload manually.

### AI Analysis Data Flow
- Bedrock returns JSON with: summary, topics[], sentiment, performance_score, sub_scores, action_items[], feedback{strengths[], suggestions[]}, flags[], detected_agent_name
- `ai-provider.ts` builds the prompt via `buildAnalysisPromptParts()` (split into cacheable system + per-call user parts) and parses JSON response
- `assemblyai.ts:processTranscriptData()` normalizes AI output into storage format
- **Prompt caching**: The Bedrock Converse API `system` message with `cachePoint` caches the static instruction portion (~1500 chars) across calls with the same category/template. Cached input tokens are 90% cheaper. Cache metrics are logged per call.
- **Prompt template caching**: Templates are cached in-memory with 5-minute TTL to avoid S3 round-trips. Cache is invalidated on template create/update/delete.
- **Important**: AI may return objects instead of strings in arrays — server normalizes with `normalizeStringArray()`, frontend has `toDisplayString()` safety

### Storage Backend Selection (server/storage.ts)
- `STORAGE_BACKEND=s3` or `S3_BUCKET` env var → S3
- Otherwise → **in-memory (non-persistent — data is lost on restart)**

## API Routes Overview

### Public (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (returns `{ status, timestamp }`) |
| POST | `/api/auth/login` | Login (rate limited: 5 attempts/15min per IP) |
| POST | `/api/auth/logout` | Logout & clear session |
| GET | `/api/auth/me` | Get current user |

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
| GET | `/api/prompt-templates` | admin | List prompt templates |
| POST | `/api/prompt-templates` | admin | Create prompt template |
| PATCH | `/api/prompt-templates/:id` | admin | Update prompt template |
| DELETE | `/api/prompt-templates/:id` | admin | Delete prompt template |
| GET | `/api/insights` | authenticated | Aggregate insights & trends |

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

# Authentication
AUTH_USERS                      # Format: user:pass:role:name,user2:pass2:role2:name2

# AWS (for Bedrock AI + S3 storage)
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION                      # Default: us-east-1
AWS_SESSION_TOKEN               # Optional, for IAM roles

# Storage
S3_BUCKET                       # Default: ums-call-archive

# AI Model
BEDROCK_MODEL                   # Default: us.anthropic.claude-sonnet-4-6 (see server/services/bedrock.ts)

# Optional
PORT                            # Default: 5000
RETENTION_DAYS                  # Auto-purge calls older than N days (default: 90)
```

## HIPAA Compliance

| Feature | Location | Details |
|---------|----------|---------|
| **Account lockout** | `server/auth.ts` | 5 failed login attempts → 15-min lockout per IP/username |
| **Audit logging** | `server/services/audit-log.ts` | Structured JSON logs (`[HIPAA_AUDIT]`) for all PHI access — user identity, resource type, timestamps |
| **API access audit** | `server/index.ts` | Middleware logs all API calls with user, method, status, duration |
| **Rate limiting** | `server/index.ts` | Login: 5/15min per IP. Generic limiter on sensitive paths |
| **CSP headers** | `server/index.ts` | Content-Security-Policy restricts to same-origin + trusted CDNs |
| **Security headers** | `server/index.ts` | X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, HSTS, Referrer-Policy, Permissions-Policy |
| **Session timeout** | `server/auth.ts` | 15-min idle timeout (rolling) + 8-hour absolute max |
| **Secure cookies** | `server/auth.ts` | httpOnly, sameSite=lax, secure in production |
| **HTTPS enforcement** | `server/index.ts` | HTTP → HTTPS redirect in production |
| **Data retention** | `server/index.ts` | Auto-purges calls older than `RETENTION_DAYS` (default 90) |
| **Error logging** | `server/routes.ts` | Logs error messages only, never full stacks (avoids PHI leakage) |

## Key Design Decisions
- **No AWS SDK**: Both S3 and Bedrock use raw REST APIs with manual SigV4 signing — reduces bundle size and avoids SDK dependency overhead, but means signing logic must be maintained manually
- **Bedrock prompt caching**: Analysis prompt is split into system (static instructions, cacheable via `cachePoint`) and user (transcript) parts. The `buildAnalysisPromptParts()` function in `ai-provider.ts` returns `{ system, user }`, and `bedrock.ts` sends them as separate Converse API fields. Cached tokens are 90% cheaper.
- **Prompt template caching**: In-memory TTL cache (5 min) in `routes.ts` via `getCachedPromptTemplate()`. Invalidated on template create/update/delete. Avoids S3 reads on every call analysis.
- **Custom prompt templates**: Per-call-category evaluation criteria, required phrases, scoring weights
- **Dark mode**: Toggle in settings; chart text fixed via global CSS in index.css (.dark .recharts-*)
- **Hooks ordering**: All React hooks in transcript-viewer.tsx MUST be called before early returns (isLoading/!call guards)
- **A/B test isolation**: Test calls stored under `ab-tests/` S3 prefix, completely separate from production `calls/`, `analyses/`, etc. — no risk of contaminating metrics

## Deployment

### Render.com (Primary)
No `render.yaml` in repo — deployment is configured via the Render dashboard.

- **Build command**: `npm run build` (Vite frontend → `dist/client/`, esbuild backend → `dist/index.js`)
- **Start command**: `npm run start` (`NODE_ENV=production node dist/index.js`)
- **Environment variables**: Configured in Render dashboard
- Server serves both API and static frontend assets from the same process

### EC2 (Secondary / Testing)
The app can also run on an EC2 instance managed with **pm2**.

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
pm2 restart all             # Restart to pick up changes
pm2 logs --lines 20         # Verify startup — look for:
                            #   [STORAGE] Using S3 (bucket: ums-call-archive)
                            #   NOT: "S3 authentication not configured"
```

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

## Common Gotchas
- Bedrock AI responses may contain objects where strings are expected — always use `toDisplayString()` on frontend and `normalizeStringArray()` on server when rendering/storing AI data
- The same IAM user is shared across 3 projects (CallAnalyzer, RAG Tool, PMD Questionnaire) — IAM policy covers S3, Bedrock, and Textract
- Recharts uses inline styles that override CSS; dark mode fixes use `!important`
- The `useQuery` key format is `["/api/calls", callId]` — TanStack Query uses the key for caching
- In-memory storage backend loses all data on restart — only use for local development without cloud credentials
- `.env.example` may be outdated (e.g., shows haiku model but code defaults to sonnet) — always check `server/services/bedrock.ts` for the actual default
- `buildAnalysisPrompt()` is a legacy wrapper that delegates to `buildAnalysisPromptParts()` — new code should use the parts version directly for caching benefits
- Prompt template cache (`promptTemplateCache` in routes.ts) has a 5-min TTL — if testing template changes, templates propagate within 5 minutes (or immediately on create/update/delete via cache invalidation)
- Cost estimation (`estimateBedrockCost`) accepts an optional `cacheReadTokens` param — cached tokens are charged at 10% of the regular input rate
