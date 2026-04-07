Do not make any changes to any files during this session.
Do not run audits or recommendations — this session produces a systems map only.
$ARGUMENTS
You are constructing a systems map of this codebase in five targeted phases. Each phase reads specific files and produces specific outputs. Do not skip phases or combine them.

PHASE 1 — Entry points and project structure
Read: package.json, tsconfig.json (root), server/index.ts, client/src/main.tsx (or client/src/App.tsx), server/routes.ts
List every top-level directory in server/ and client/src/. For each, write one sentence describing its responsibility based on what you can infer from the entry points alone. Flag any directory you cannot describe from entry points — these need deeper reading in Phase 2.

PHASE 2 — Module identification
Read every file flagged in Phase 1, plus: all files in server/services/, server/routes/, server/db/, server/middleware/. For each major module (group related files as one module), write:

Module name and files
One-sentence responsibility
What it initializes, what it depends on to start
Whether its startup dependency is guaranteed by the initialization sequence — or whether it assumes something exists (env var, table, service connection, initialized singleton) that could be absent in a fresh environment or a partial deploy

Do not read into implementation details — focus on what each module IS, what it needs, and whether those needs are provably satisfied at the point it runs.

PHASE 3 — Data flow tracing
Trace these three paths end-to-end by following actual function calls and imports (read each file in the chain):
Path 1: Audio upload → analysis completion
Start at the upload handler in server/routes.ts or server/routes/calls.ts. Follow every function call through pipeline.ts until storage and WebSocket broadcast.
Path 2: AssemblyAI webhook → transcript stored
Start at the AssemblyAI webhook endpoint in server/routes.ts. Follow through transcript processing to storage.
Path 3: Authentication
Start at POST /api/auth/login in server/routes/auth.ts. Follow through session creation, fingerprint binding, and per-request validation.
For each path: list the exact files and functions in sequence, note any async handoffs (job queue enqueue, webhook callback, batch scheduler), and flag any step where you had to infer rather than read.

PHASE 4 — Dependency map construction
For each module identified in Phase 2:

List every function, class, constant, and type it exports
Find every file that imports from it (search imports/requires)
Record: [Module] → exports [X] → consumed by [Y, Z]

Flag any exports you found but could not trace to a consumer (dead exports). Flag any imports from a module that are NOT in its export list (potential runtime errors or dynamic access patterns).
Pay special attention to:

server/routes/utils.ts (TaskQueue, requireRole, validateParams — consumed by many routes)
server/services/resilience.ts (circuit breaker — wraps Bedrock calls)
server/services/job-queue.ts (PostgreSQL-backed queue — consumed by routes.ts)
server/constants.ts (scoring thresholds — consumed by pipeline, coaching, gamification)


PHASE 5 — Cross-reference validation
Verify these specific dependency claims by reading the actual import statements:

shared/schema.ts — confirm it is imported by at least one route file, storage.ts, and one client file
server/storage.ts — confirm it is imported by approximately 27 files. Verified consumers include: server/routes/pipeline.ts, all route files, auth.ts, gamification.ts, coaching-alerts.ts, batch-scheduler.ts, and several supporting services. Note: webhooks.ts uses initWebhooks() callback pattern — it does NOT directly import storage. Flag any consumer count below 20 or above 35 as a discrepancy worth investigating.
server/routes/pipeline.ts — this module has 3 named exports. Confirm all 3 are documented in the dependency map and all callers of the primary audio processing function are identified (confirmed consumer: server/routes.ts only).
server/services/ai-factory.ts — confirm aiProvider is imported by pipeline.ts and verify whether routes/reports.ts also imports it (for agent summaries).
server/services/assemblyai.ts — confirm assemblyAIService and handleAssemblyAIWebhook are consumed by pipeline.ts and the webhook endpoint in routes.ts.
server/services/s3.ts — confirmed exactly 1 direct importer: storage.ts. bedrock-batch.ts and webhooks.ts access S3 via alternative patterns (not direct S3Client imports). Flag any new direct importer of S3Client other than storage.ts as a red flag — all S3 access should route through the storage abstraction.
server/auth.ts — confirm requireAuth and requireRole are applied to all non-public routes; verify the intentional public bypass endpoints (/api/health, /api/auth/login, /api/auth/logout, /api/webhooks/assemblyai). Note: requireRole is exported from auth.ts — it is NOT exported from server/routes/utils.ts.
server/services/rag-client.ts — confirmed consumers: pipeline.ts, coaching-alerts.ts, scoring-feedback.ts, best-practice-ingest.ts. Verify all 4 are still present; flag any new consumers or missing consumers.
server/services/rag-hybrid.ts — this file was confirmed dead code and has been removed from the codebase. Verify it no longer exists on disk. If it has been re-added or re-created, flag as a significant change requiring documentation and update the SUBSYSTEM FILE REFERENCE in audit.md accordingly.

For each claim: state VERIFIED or DISCREPANCY, and note what you found vs what was expected. If any claim cannot be verified from file contents (inferred from context), flag as LOW CONFIDENCE.

FINAL OUTPUT — Systems map
After all five phases, produce:

Module map — all modules from Phase 2 with one-sentence responsibilities
Data flow paths — the three paths from Phase 3 as concise step sequences
External dependencies — all third-party services and SDKs
Auth and security surface — where auth is enforced, where PHI is touched, intentional public bypass points
Inter-module dependency map — the verified output from Phases 4 and 5
Confidence notes — any section where you were inferring rather than reading
Discrepancies — anything in the existing CLAUDE.md systems map that contradicts what you found
Ranked lists:

3–5 highest-complexity subsystems (most likely to contain hidden issues)
3–5 highest-risk subsystems (most likely to cause problems if broken)


Recommended CLAUDE.md update — specific lines in the systems map section of CLAUDE.md that should be added, changed, or removed based on what you found

Produce the map in a format ready to paste directly into CLAUDE.md under "## Systems Map".
