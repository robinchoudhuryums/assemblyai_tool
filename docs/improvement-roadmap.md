# CallAnalyzer — Long-Term Improvement Roadmap

Items below are multi-sprint efforts identified during comprehensive codebase audits (March–April 2026). Each has context and acceptance criteria to enable future implementation.

---

## Testing & Coverage (Target: 70%+ backend, 40%+ frontend)

**Current state**: 955 tests across 37+ files. Backend: 781 tests across 168 suites, ~67% statement coverage, ~85% branch coverage. Frontend: 174 tests across 21 files. Route endpoint integration tests use real route handlers with MemStorage.

### ~~Sprint 1 — Route endpoint tests~~ ✅ MOSTLY DONE
- ✅ Test app factory and `request()` helper created (`tests/routes.test.ts`)
- ✅ Auth enforcement, RBAC, input validation, CSV export, MemStorage CRUD tests
- ✅ Real route handler tests (`tests/route-endpoints.test.ts`): employees CRUD, calls CRUD (list, get, assign, delete, transcript, analysis), user management (auth, validation, MemStorage limits), dashboard metrics
- Remaining: add route-specific tests for:
  - `analytics.ts` — team analytics, trends, exports
  - `admin-security.ts` — WAF stats, IP blocking, vulnerability scans
  - `coaching.ts` — session creation, category validation, action item toggle

### ~~Sprint 2 — Frontend component tests~~ ✅ MOSTLY DONE
- ✅ Lib utilities: display-utils, saved-filters, dashboard-config, i18n, constants, appearance
- ✅ Hooks: useBeforeUnload
- ✅ Pages: dashboard, search, auth, not-found
- ✅ Components: error-boundary, file-upload, call-card, button
- Remaining: transcripts.tsx, reports.tsx, employees.tsx, sidebar, calls-table

### Sprint 3 — E2E user workflow tests
- Extend Playwright tests (`e2e/`) beyond basic navigation:
  - Full upload → transcribe → analyze → view transcript flow (requires mock AssemblyAI)
  - Manager coaching workflow: flag call → create session → assign action items → complete
  - Admin user management: create user → assign role → password reset
  - Export workflows: CSV download, report generation
  - Search + filter: query → apply filters → click through to details
- Consider using MSW (Mock Service Worker) for external API mocking

### ~~Sprint 4 — Coverage reporting and thresholds~~ ✅ DONE
- ✅ c8 coverage reporting: `npm run test:coverage` generates text + text-summary reports
- ✅ Baseline established: 67% statements, 85% branches
- Remaining: Add Vitest coverage for frontend, set CI gates (fail if below threshold), Codecov integration

---

## Security Hardening

### ~~SSRF protection gaps~~ ✅ COMPLETED
- Shared URL validator with DNS resolution check, expanded blocklist, IPv6-mapped IPv4, HTTPS enforcement
- 45 SSRF tests

### ~~WAF regex DoS~~ ✅ COMPLETED
- Replaced monolithic SQL injection regex with focused non-overlapping patterns
- Added input truncation (4KB) before regex matching
- SELECT...FROM requires SQL column syntax (prevents false positives on English prose)

### ~~Audit log integrity~~ ✅ COMPLETED
- HMAC-SHA256 chain on stdout entries — each hash covers content + previous hash
- Tamper/deletion/reorder detectable by walking chain

### ~~TOTP replay protection~~ ✅ COMPLETED
- Used-token cache per secret+time-step with 2-minute auto-cleanup

### ~~Route parameter validation~~ ✅ COMPLETED
- `validateParams()` middleware with uuid/safeId/safeName formats applied to 30+ routes

### WAF slow-attack resilience (`server/middleware/waf.ts`)
- Anomaly scoring can be bypassed by very slow attacks (1 req/min stays below window)
- Add: reputation-based blocking (total violations per IP regardless of time window)
- Add: graduated response (warn → throttle → block) based on cumulative anomaly score

### ~~Rate limiting before body parsing~~ — NOT NEEDED
- Investigated: `app.post("/api/calls/upload", rateLimit(...))` already runs before multer middleware

### ~~Prompt injection detection~~ ✅ COMPLETED (ported from KB)
- 16 input patterns + output anomaly detection in `server/services/prompt-guard.ts`
- Scans transcripts before Bedrock analysis; adds flags for reviewer visibility

### ~~PHI redaction in audit logs~~ ✅ COMPLETED (ported from KB)
- 14 HIPAA identifier patterns in `server/services/phi-redactor.ts`
- Auto-redacts `detail` field in all audit entries before persistence

### ~~Circuit breaker for Bedrock~~ ✅ COMPLETED (ported from KB)
- `server/services/resilience.ts` — 5 failures → open 30s → half-open test
- Wraps all 3 Bedrock methods (generateText, analyzeCallTranscript, generateEmbedding)

### ~~Password history~~ ✅ COMPLETED (ported from KB)
- Prevents reuse of last 5 passwords on self-service change and admin reset

### ~~Double-submit CSRF~~ ✅ COMPLETED (ported from KB)
- SameSite=Strict cookie + X-CSRF-Token header on all state-changing requests

### ~~Idle timeout warning~~ ✅ COMPLETED (ported from KB)
- 2-minute countdown dialog before auto-logout at 15 min idle

### ~~Correlation IDs + structured logging~~ ✅ COMPLETED (ported from KB)
- AsyncLocalStorage per-request UUID, auto-injected into all JSON log entries

### ~~OpenTelemetry tracing~~ ✅ COMPLETED (ported from KB)
- Spans on bedrock.analyze, bedrock.generateText, rag.fetchContext
- Compatible with Jaeger, Grafana Tempo, Datadog, AWS X-Ray

### ~~SSL hardening~~ ✅ COMPLETED
- Production always enforces `rejectUnauthorized: true` regardless of env var

### ~~RAG knowledge base integration~~ ✅ COMPLETED
- `server/services/rag-client.ts` — queries ums-knowledge-reference with X-API-Key auth
- LFU cache (50 entries, 30min TTL), confidence filtering, source storage
- Coaching alerts reuse sources from analysis (no duplicate API call)

---

## Audit Cycle — Recently Completed (Spring 2026)

Fixes shipped across three `/broad-scan` → `/broad-implement` cycles.

### Features shipped
- ✅ **Prompt template back-testing** — `POST /api/prompt-templates/:id/test` runs a candidate template against the last 1-10 completed calls in its category; results not persisted
- ✅ **Weekly change dashboard narrative** — `GET /api/dashboard/weekly-changes` + `WeeklyChangesWidget` showing top movers, flag deltas, noteworthy calls, and a one-line narrative
- ✅ **A/B test winner promotion flow** — `GET /api/ab-tests/aggregate` + `POST /api/ab-tests/promote` + `active-model.ts` S3 persistence + `Promote Winner` UI tab. Both on-demand (`aiProvider`) and batch (`bedrockBatchService`) paths observe promotions.

### Bugs and gaps closed
- ✅ **S2-C1** Scoring-correction `reason` sanitization + `<<<UNTRUSTED_MANAGER_NOTES>>>` delimiter wrap (prompt injection defense)
- ✅ **#1** `content_hash` UNIQUE partial index added to `schema.sql` (fresh deploys no longer depend on second-boot `runMigrations`)
- ✅ **#2** `gracefulShutdown()` drains `JobQueue` before DB pool close (15s cap)
- ✅ **#6** `BEDROCK_MODEL` validated at startup + runtime `warnOnUnknownBedrockModel()` with once-per-model Sentry alert
- ✅ **#7** `advanceIncidentPhase`, `addIncidentTimelineEntry`, `addActionItem` refactored to DB-first clone pattern
- ✅ **#9** `requireAuth` converted to async and awaits `req.logout()` + `req.session.destroy()` before responding 401
- ✅ **#10** `DELETE /api/calls/:id/tags/:tagId` enforces author-or-manager authorization
- ✅ **#3** Audit queue `MAX_QUEUE_SIZE` raised to 20000 with one-shot Sentry escalation on first drop per process
- ✅ **#5** Scheduled reports catch-up walks back 12 weekly + 12 monthly boundaries (was single boundary)
- ✅ **#8** Batch tracking-write has retry + `orphaned-submissions/` fallback + `promoteOrphanedSubmissions()` self-heal
- ✅ `/api/users/me/password` enforces `requireMFASetup` (closes last per-route MFA gap)
- ✅ `bedrockBatchService.setModel()` wired into `promoteActiveModel()` (closes A/B promotion asymmetry)
- ✅ `isPasswordReused` defensively caps history at `PASSWORD_HISTORY_SIZE` (CPU DoS defense)
- ✅ `validateTimestamps` no longer silently strips invalid feedback timestamps — logs + flags `output_anomaly:invalid_feedback_timestamps:N`

### Audit findings retracted on close reading
- ❌ H6 "No hard cap on transcript tokens to Bedrock" — `smartTruncate()` IS called at `ai-provider.ts:132`
- ❌ #4 (batch A) "Circuit breaker retry accounting" — breaker wraps HTTP call only; `parseJsonResponse()` runs outside breaker so parse failures never touch breaker slots
- ❌ #1 (batch C) "PHI leak in prompt-injection `console.warn`" — `reasons` are static category labels, not matched transcript substrings
- ❌ #4 (batch C) "No PHI audit entry on audio streaming" — `logPhiAccess` already present at `routes/calls.ts:232`

---

## Open From Audit Cycles (Spring 2026)

### ~~Remaining incident-response refactor~~ ✅ RESOLVED (verified Stage 2, April 2026)
- `updateActionItem` in `server/services/incident-response.ts:437-451` IS clone-then-persist. Roadmap entry was stale.

### ~~Audit log HMAC chain drift (top-10 #5)~~ ✅ RESOLVED (F-06, April 2026 cycle)
- `startIntegrityPersistScheduler()` persists the HMAC chain head on a 30s interval (skip-if-unchanged). Bounds the crash-mid-burst gap between fire-and-forget per-entry persists and durable DB commit. Wired into startup + graceful shutdown; timer `.unref()`'d per INV-30.

### Audit queue spool-to-disk (non-lossy variant)
- Current design is drop-oldest with loud Sentry escalation. A truly non-lossy upgrade would spool overflow entries to a local JSONL file and drain them back into the queue on each flush cycle. Complexity: file rotation, atomic writes, PHI-on-disk considerations. Effort: **M**

### ~~Scheduled reports hourly catch-up~~ ✅ RESOLVED (prior cycle)
- `runCatchUp()` now runs on every hourly `checkAndGenerate` tick (idempotent via `reportExistsForPeriod` short-circuit). Recovers failed mid-hour reports within an hour instead of waiting for process restart.

### Batch pre-submit intent file
- Current batch orphan recovery covers the `createJob` → tracking-write gap with retry + fallback + Sentry, but a narrow window still exists where AWS accepts the job and the process crashes before either write completes. **Fix**: write a "pre-submit intent" file to S3 before calling `createJob`, reconcile on next cycle. Effort: **M**

### Coaching outcomes dashboard (strategic, top-10 #9)
- **Partially shipped**: `/coaching` has a program-effectiveness panel with per-group + weekly sparkline + avgSubDeltas chips, and the DetailPanel shows per-session before/after outcomes. **Residual gap**: no per-agent sub-score trajectory chart showing the N calls following a specific coaching session as a time-series. Data primitives exist (`call_analyses.subScores` + `coaching_sessions.created_at`); the missing piece is the visualization. Effort: **S–M**

### Weekly digest email — "interesting three"
- Stage 3 strategic suggestion: passive engagement surface via weekly email with top 3 noteworthy calls (one exceptional, one compliance risk, one coaching opportunity). Builds on existing scheduled-reports + webhooks. Effort: **M**

### ~~`console.warn` pattern in pipeline~~ ✅ COMPLETED (April 2026 cycle)
- Direct `console.*` calls in production paths were migrated to structured `logger.*` in prior cycles. The April 2026 follow-on closed the related silent-`.catch(() => {})` hazard surface (coaching webhook trigger, three startup hydration loaders, two best-effort S3 cleanup paths). Only documented exceptions remain: `server/vite.ts` (CSS-styled dev terminal output) and the canonical `[HIPAA_AUDIT]` stdout line in `audit-log.ts:313`.

---

## Code Quality & Maintainability

### ~~Standardized error responses~~ ✅ COMPLETED
- `sendError()` and `sendValidationError()` helpers in `server/routes/utils.ts`
- All 15 inline `.error.flatten()` calls converted to use `sendValidationError()`
- Fixed `employees.ts` inconsistency (was using raw `error.errors` instead of `.flatten()`)

### ~~CodeQL SAST scanning~~ ✅ COMPLETED
- `.github/workflows/codeql.yml` — runs on push to main, PRs, and weekly
- Uses `security-extended` query suite

### ~~Dependabot~~ ✅ COMPLETED
- `.github/dependabot.yml` — weekly npm + GitHub Actions version scanning

### ~~Role config extraction~~ ✅ COMPLETED
- `ROLE_CONFIG` in `client/src/lib/constants.ts` — single source of truth for badge colors/labels

### Query builder adoption
- Replace manual SQL string concatenation in `storage-postgres.ts` and route files with a query builder (Knex or Drizzle ORM)
- Eliminates structural SQL injection risk and simplifies complex dynamic WHERE clauses
- Estimated: 2-3 sprints for full migration (can be incremental, route-by-route)

### ~~Replace `any` casts~~ ✅ MOSTLY DONE
- Reduced from 33 to 7 `as any` casts across 17 files
- Added Express.User type augmentation, SessionData.fingerprint typing
- Remaining 7 are at type system boundaries (WebSocket, Passport 0.7 compat)

### ~~Auto-calibration completion~~ ✅ COMPLETED
### ~~Remaining code duplication~~ ✅ COMPLETED

---

## Accessibility (WCAG 2.1 AA)

### ~~Completed~~
- ✅ 14 icon-only buttons have `aria-label` attributes
- ✅ Global `:focus-visible` outline styles for keyboard navigation
- ✅ `role="alert"` on dashboard flagged-calls banner, report errors, transcript flags
- ✅ `role="status"` on exceptional-calls banner
- ✅ Skip-to-content link (`<a href="#main-content">`) in App.tsx
- ✅ Chart screen reader descriptions (dashboard trend, sentiment pie)
- ✅ MFA error recovery (clear code on failure, auto-focus input)

### Remaining work
- Audit remaining icon-only buttons (coaching.tsx task removal)
- Add `role` and `aria-` attributes to custom components (sortable table headers, filter pills)
- Test with screen reader (VoiceOver/NVDA) and fix any announced-content issues
- Add visible focus indicators to Recharts tooltip interactions

---

## Infrastructure & Observability

### ~~Blue-green deployment~~ ✅ IMPLEMENTED
### ~~Post-deploy health verification~~ ✅ COMPLETED
- Deploy workflow validates `/api/health` response body (not just HTTP 200)
- 5 retry attempts, warns on "degraded" status

### ~~Database monitoring~~ ✅ COMPLETED
- Error monitor workflow checks PostgreSQL connectivity via `psql SELECT 1`

### ~~Dependabot~~ ✅ COMPLETED

### Secret management
- Move from `.env` files to AWS Secrets Manager or SSM Parameter Store
- Benefits: automatic rotation, audit trail, no secrets on disk
- Requires: IAM policy update, startup code changes to fetch secrets

### ~~Structured observability~~ ✅ COMPLETED
- OpenTelemetry auto-instrumentation via `server/services/tracing.ts`
- Per-request correlation IDs via `AsyncLocalStorage` in `server/services/correlation-id.ts` — injected into every structured log line
- Metrics counters + histograms exposed at `GET /api/admin/metrics` (Prometheus-style)
- Tracks: `http_requests_total` by method/status, `http_request_duration_ms` histogram, `http_errors_total`

### Automated DR failover
- Current DR plan (`docs/disaster-recovery.md`) requires manual failover
- Add: Route 53 health check → automatic DNS failover to standby region
- Add: automated RDS cross-region replica promotion script
