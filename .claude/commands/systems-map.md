Do not make any changes to any files during this session.
Do not run audits or recommendations — this session produces a systems map only.

$ARGUMENTS

You are constructing a systems map of this codebase in five targeted phases. Each phase reads specific files and produces specific outputs. Do not skip phases or combine them.

---

PHASE 1 — Entry points and project structure
Read: package.json, tsconfig.json (root), server/index.ts, client/src/main.tsx (or client/src/App.tsx), server/routes.ts
List every top-level directory in server/ and client/src/. For each, write one sentence describing its responsibility based on what you can infer from the entry points alone. Flag any directory you cannot describe from entry points — these need deeper reading in Phase 2.

---

PHASE 2 — Module identification
Read every file flagged in Phase 1, plus: all files in server/services/, server/routes/, server/db/, server/middleware/. For each major module (group related files as one module), write:
- Module name and files
- One-sentence responsibility
- What it initializes, what it depends on to start

Do not read into implementation details — focus on what each module IS and what it needs.

---

PHASE 3 — Data flow tracing
Trace these three paths end-to-end by following actual function calls and imports (read each file in the chain):

Path 1: Audio upload → analysis completion
Start at the upload handler in server/routes.ts or server/routes/calls.ts. Follow every function call through pipeline.ts until storage and WebSocket broadcast.

Path 2: AssemblyAI webhook → transcript stored
Start at the AssemblyAI webhook endpoint in server/routes.ts. Follow through transcript processing to storage.

Path 3: Authentication
Start at POST /api/auth/login in server/routes/auth.ts. Follow through session creation, fingerprint binding, and per-request validation.

For each path: list the exact files and functions in sequence, note any async handoffs (job queue enqueue, webhook callback, batch scheduler), and flag any step where you had to infer rather than read.

---

PHASE 4 — Dependency map construction
For each module identified in Phase 2:
1. List every function, class, constant, and type it exports
2. Find every file that imports from it (search imports/requires)
3. Record: [Module] → exports [X] → consumed by [Y, Z]

Flag any exports you found but could not trace to a consumer (dead exports). Flag any imports from a module that are NOT in its export list (potential runtime errors or dynamic access patterns).

Pay special attention to:
- server/routes/utils.ts (TaskQueue, requireRole, validateParams — consumed by many routes)
- server/services/resilience.ts (circuit breaker — wraps Bedrock calls)
- server/services/job-queue.ts (PostgreSQL-backed queue — consumed by routes.ts)
- server/constants.ts (scoring thresholds — consumed by pipeline, coaching, gamification)

---

PHASE 5 — Cross-reference validation
Verify these specific dependency claims by reading the actual import statements:

1. shared/schema.ts — confirm it is imported by at least one route file, storage.ts, and one client file
2. server/storage.ts — confirm it is imported by server/routes/pipeline.ts and at least 5 route files
3. server/routes/pipeline.ts — confirm all callers of processAudioFile() (or the main pipeline function) are identified
4. server/services/ai-factory.ts — confirm aiProvider is imported by pipeline.ts and verify whether routes/reports.ts also imports it (for agent summaries)
5. server/services/assemblyai.ts — confirm assemblyAIService and handleAssemblyAIWebhook are consumed by pipeline.ts and the webhook endpoint in routes.ts
6. server/services/s3.ts — confirm S3Client is imported by storage.ts and bedrock-batch.ts; verify whether any other service imports it directly
7. server/auth.ts — confirm requireAuth and requireRole are applied to all non-public routes; verify the intentional public bypass endpoints (/api/health, /api/auth/login, /api/auth/logout, /api/webhooks/assemblyai)
8. server/services/rag-hybrid.ts — confirm whether this file is actually imported anywhere (the systems map flags it as potentially unused)

For each claim: state VERIFIED or DISCREPANCY, and note what you found vs what was expected. If any claim cannot be verified from file contents (inferred from context), flag as LOW CONFIDENCE.

---

FINAL OUTPUT — Systems map

After all five phases, produce:

1. Module map — all modules from Phase 2 with one-sentence responsibilities
2. Data flow paths — the three paths from Phase 3 as concise step sequences
3. External dependencies — all third-party services and SDKs
4. Auth and security surface — where auth is enforced, where PHI is touched, intentional public bypass points
5. Inter-module dependency map — the verified output from Phases 4 and 5
6. Confidence notes — any section where you were inferring rather than reading
7. Discrepancies — anything in the existing CLAUDE.md systems map that contradicts what you found
8. Ranked lists:
   - 3–5 highest-complexity subsystems (most likely to contain hidden issues)
   - 3–5 highest-risk subsystems (most likely to cause problems if broken)
9. Recommended CLAUDE.md update — specific lines in the systems map section of CLAUDE.md that should be added, changed, or removed based on what you found

Produce the map in a format ready to paste directly into CLAUDE.md under "## Systems Map".