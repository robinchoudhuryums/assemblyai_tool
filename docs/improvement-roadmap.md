# CallAnalyzer — Long-Term Improvement Roadmap

Items below are multi-sprint efforts identified during comprehensive codebase audits (March–April 2026). Each has context and acceptance criteria to enable future implementation.

---

## Testing & Coverage (Target: 70%+ backend, 40%+ frontend)

**Current state**: 850 tests across 36+ files. Backend: 726 tests, ~67% statement coverage, ~85% branch coverage. Frontend: 124 tests across 15 files. Route endpoint integration tests use real route handlers with MemStorage.

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

### Replace `any` casts
- 15+ instances of `as any` across routes/snapshots/analytics/storage-postgres
- Incremental: create proper types, use type guards
- Estimated: 1-2 days

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

### Structured observability
- Add OpenTelemetry or structured logging (JSON) with correlation IDs per request
- Add metrics endpoint (`/metrics`) for Prometheus/CloudWatch scraping
- Track: request latency p50/p95/p99, AI analysis duration, queue depth, error rates

### Automated DR failover
- Current DR plan (`docs/disaster-recovery.md`) requires manual failover
- Add: Route 53 health check → automatic DNS failover to standby region
- Add: automated RDS cross-region replica promotion script
