If $ARGUMENTS is empty or missing, respond with exactly this and stop:

Usage: /targeted-audit <subsystem-name>

Available subsystems:
- Core Architecture & Pipeline
- Storage Layer / Database
- AI Processing & Analysis
- Security & Compliance
- AWS & External Integrations
- RAG & Knowledge Base
- Engagement & Reporting
- Frontend / UI

Example: /targeted-audit Security & Compliance

---

Read CLAUDE.md (especially Common Gotchas and Key Design Decisions)
before starting. Do not make any changes to any files during this session.

SUBSYSTEM FILE REFERENCE:
Core Architecture & Pipeline:
  server/index.ts, server/routes.ts, server/routes/pipeline.ts, server/routes/utils.ts, server/middleware/waf.ts, server/middleware/rate-limit.ts, server/middleware/error-handler.ts, server/types.d.ts
Storage Layer / Database:
  server/storage.ts, server/storage-postgres.ts, server/db/pool.ts, server/db/schema.sql
AI Processing & Analysis:
  server/services/assemblyai.ts, server/services/bedrock.ts, server/services/ai-provider.ts, server/services/ai-factory.ts, server/services/bedrock-batch.ts, server/services/batch-scheduler.ts, server/services/scoring-calibration.ts, server/services/auto-calibration.ts
Security & Compliance:
  server/auth.ts, server/services/audit-log.ts, server/services/security-monitor.ts, server/services/vulnerability-scanner.ts, server/services/incident-response.ts, server/services/totp.ts, server/services/phi-redactor.ts, server/services/prompt-guard.ts, server/services/url-validator.ts, server/services/resilience.ts, server/routes/access-requests.ts
AWS & External Integrations:
  server/services/s3.ts, server/services/sigv4.ts, server/services/aws-credentials.ts, server/services/telephony-8x8.ts, server/services/webhooks.ts
RAG & Knowledge Base:
  server/services/rag-client.ts, server/services/best-practice-ingest.ts, server/services/medical-synonyms.ts, server/services/scoring-feedback.ts
Engagement & Reporting:
  server/services/gamification.ts, server/services/coaching-alerts.ts, server/services/performance-snapshots.ts, server/services/scheduled-reports.ts, server/routes/coaching.ts, server/routes/gamification.ts, server/routes/analytics.ts, server/routes/reports.ts, server/routes/insights.ts, server/routes/snapshots.ts
Frontend / UI:
  client/src/App.tsx, client/src/pages/, client/src/components/, client/src/lib/queryClient.ts, client/src/lib/i18n.ts, client/src/hooks/

This session's scope: $ARGUMENTS
Use the file reference above to identify relevant files.

[OPTIONAL: PASTE ANY FOLLOW-ON ITEMS FROM A PRIOR SESSION THAT FLAGGED THIS SUBSYSTEM]

[OPTIONAL: PASTE ANY POLICY RESPONSE TRIGGERED BLOCKS FROM THE LAST HEALTH SYNTHESIS — if triggered, these are MANDATORY scope additions]

Audit this subsystem thoroughly. For each finding:
- State the issue, cite file and function/line
- Severity: Critical / High / Medium / Low
- Confidence: High / Medium / Low
- Would this bug actually fire in production this month? YES (describe
  the trigger) or NO (explain why)
- Effort to fix: S (< 2 hours) / M (half-day to 2 days) / L (3+ days)

Focus on:
- Bugs and logic errors in currently-reachable code paths
- Security concerns specific to this module
- Inconsistencies between CLAUDE.md and actual implementation
- Cross-module dependencies this subsystem has — what would break
  in OTHER modules if we change things here
- Silent degradation paths: places where failure is swallowed and the
  app continues with wrong results rather than surfacing an error

DO NOT flag style preferences, speculative improvements, or "could be
cleaner" refactoring unless the current code is actively wrong.

After the audit, produce an implementation plan. For each action:
- Action ID (A1, A2, A3...)
- What specifically to do (concrete, not "improve error handling")
- Which finding(s) it addresses
- Effort: S / M / L
- Cross-module risk: Low / High
- Prerequisites: other actions that must complete first

Organize into:
1. Fix now — production bugs, security issues, blocking problems
2. Fix this session — high-value, well-scoped, low cross-module risk
3. Defer — needs more context, high risk, or dependencies outside scope

End with a TIER 2 HANDOFF BLOCK:

---TIER 2 HANDOFF BLOCK---
Scope: [subsystem]
Findings: [count] total — [critical/high/medium/low breakdown]
Production bugs (would fire this month): [count of YES answers]

ACTIONS (implement in this order):
[ID] | [File: area] | [Effort] | [Risk] | [Description]

CROSS-MODULE RISKS:
- [what could break outside this scope and where to verify]
(or "None identified")

DO NOT TOUCH:
- [any files/functions that are high-risk to modify without deeper
  investigation — explain why]
---END TIER 2 HANDOFF BLOCK---
