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

### ~~SSRF protection gaps~~ ✅ COMPLETED
- Shared URL validator (`server/services/url-validator.ts`) with DNS resolution check, expanded blocklist, IPv6-mapped IPv4 support, HTTPS enforcement
- Applied to webhook create, update (was unvalidated), and delivery (runtime check)
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

### ~~Blue-green deployment~~ ✅ IMPLEMENTED

**Status**: Script, pm2 ecosystem config, and Caddy config created. To enable on EC2: replace Caddyfile with `Caddyfile.bluegreen`, reload Caddy, use `deploy-bluegreen.sh`.

**Goal**: Zero-downtime deploys with instant rollback. Currently, `pm2 reload` provides near-zero-downtime, but a failed deploy still requires a full rebuild + restart cycle.

**Architecture**:
```
/home/ec2-user/
├── callanalyzer-blue/          # Live (serves traffic)
│   ├── dist/                   # Built artifacts
│   └── .env → ../shared/.env
├── callanalyzer-green/         # Staging (built and verified before swap)
│   ├── dist/
│   └── .env → ../shared/.env
├── shared/
│   └── .env                    # Single source of truth for config
└── active → callanalyzer-blue  # Symlink: which dir is live
```

**Deploy flow** (`deploy-bluegreen.sh`):
1. Determine which slot is live (blue) and which is staging (green)
2. `git pull` + `npm install` + `npm run build` in green directory
3. Start green on a different port (e.g., `PORT=5001 pm2 start dist/index.js --name callanalyzer-green`)
4. Health-check green on port 5001 (`curl -sf http://localhost:5001/api/health`)
5. If healthy: update Caddy upstream to port 5001 via admin API (`curl localhost:2019/config/...`)
6. Stop blue process (`pm2 delete callanalyzer-blue`)
7. Update `active` symlink to point to green
8. If unhealthy: kill green, blue stays live — **zero user impact**

**Required changes**:
- `deploy-bluegreen.sh` — new script (~80 lines), replaces `deploy.sh` for production
- `Caddyfile` — enable Caddy admin API (`admin localhost:2019`), use upstreams block
- pm2 ecosystem file (`ecosystem.config.cjs`) — manage named processes per slot
- Shared `.env` via symlink — both slots read same config
- GitHub Actions deploy workflow — point to new script
- Port allocation: blue=5000, green=5001 (configurable)

**Rollback**: Instant — just swap Caddy back to the old port. Old process is still running.

**Estimated effort**: 2-3 hours for full implementation + testing.

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
