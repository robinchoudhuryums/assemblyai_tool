# CallAnalyzer — Long-Term Improvement Roadmap

Items below are multi-sprint efforts identified during a comprehensive codebase audit (March 2026). Each has context and acceptance criteria to enable future implementation.

---

## Testing & Coverage (Target: 70%+ backend, 40%+ frontend)

**Current state**: 559 tests across 24 files. Backend services: ~62% covered. Frontend: ~3% covered. No integration tests, no route endpoint tests, no E2E user workflows.

### Sprint 1 — Route endpoint tests (HIGH PRIORITY)
- Add HTTP-level integration tests for the most critical API routes:
  - `calls.ts` — upload, get, list, assign, delete
  - `analytics.ts` — team analytics, trends, exports (validates the SQL injection fixes)
  - `admin-security.ts` — WAF stats, IP blocking, vulnerability scans
  - `users.ts` — CRUD, password reset, role changes
- Use `supertest` or direct Express `app.request()` with a test MemStorage instance
- These should run in CI without DATABASE_URL

### Sprint 2 — Frontend component tests
- Priority pages: `dashboard.tsx`, `search.tsx`, `transcripts.tsx`, `reports.tsx`, `employees.tsx`
- Use Vitest + React Testing Library (already configured in `vitest.config.ts`)
- Test: query error states, loading states, user interactions, role-based rendering
- CI already runs `npm run test:client`

### Sprint 3 — E2E user workflow tests
- Extend Playwright tests (`e2e/`) beyond basic navigation:
  - Full upload → transcribe → analyze → view transcript flow (requires mock AssemblyAI)
  - Manager coaching workflow: flag call → create session → assign action items → complete
  - Admin user management: create user → assign role → password reset
  - Export workflows: CSV download, report generation
- Consider using MSW (Mock Service Worker) for external API mocking

### Sprint 4 — Coverage reporting and thresholds
- Add `c8` or `istanbul` coverage instrumentation to `npm run test`
- Add Vitest coverage (built-in) for frontend
- Set CI gates: fail if backend < 60%, frontend < 30% (raise over time)
- Consider Codecov/Coveralls integration for PR-level reporting

---

## Security Hardening

### SSRF protection gaps (`server/routes/admin-content.ts`)
- Current webhook URL validation blocks `169.254.169.254` but not all metadata endpoints
- Add: DNS resolution check (reject URLs that resolve to private IP ranges at registration time)
- Add: enforce `https://` for production webhook URLs
- Add: block `169.254.169.250`, `100.100.100.200` (other cloud metadata endpoints)

### WAF slow-attack resilience (`server/middleware/waf.ts`)
- Anomaly scoring can be bypassed by very slow attacks (1 req/min stays below window)
- Add: reputation-based blocking (total violations per IP regardless of time window)
- Add: graduated response (warn → throttle → block) based on cumulative anomaly score

### Rate limiting before body parsing (`server/index.ts`)
- Current rate limiter applies after multipart body is parsed (large uploads bypass limits)
- Add: `Content-Length` header check before body parsing for upload endpoints
- Or: apply rate limit middleware before multer middleware

---

## Code Quality & Maintainability

### Query builder adoption
- Replace manual SQL string concatenation in `storage-postgres.ts` and route files with a query builder (Knex or Drizzle ORM)
- Eliminates structural SQL injection risk and simplifies complex dynamic WHERE clauses
- Estimated: 2-3 sprints for full migration (can be incremental, route-by-route)

### Auto-calibration completion (`server/services/auto-calibration.ts`)
- Currently analyzes score distributions and logs recommendations but never applies them
- Add: admin API endpoint to review and approve recommended calibration values
- Add: optional auto-apply mode with guardrails (max shift ±0.5 per cycle)
- Add: calibration history tracking for audit trail

### Remaining code duplication
- Employee assignment logic exists in both `calls.ts` and `employees.ts` routes
- Date range filtering code is repeated across `analytics.ts`, `reports.ts`, `snapshots.ts`
- Extract shared route helpers: `validateDateRange()`, `assignEmployeeToCall()`

---

## Accessibility (WCAG 2.1 AA)

**Completed**: 14 icon-only buttons now have `aria-label` attributes (calls-table, file-upload, employees)

### Remaining work
- Audit all remaining icon-only buttons across components (coaching.tsx task removal, dashboard customize)
- Add visible focus indicators (`:focus-visible` styles) to all interactive elements
- Add `role` and `aria-` attributes to custom components (sortable table headers, filter pills)
- Test with screen reader (VoiceOver/NVDA) and fix any announced-content issues
- Add skip-to-content link for keyboard navigation

---

## Infrastructure & Observability

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
