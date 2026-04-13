If $ARGUMENTS is empty or missing, respond with exactly this and stop:

Usage: /audit <subsystem-name>
Available subsystems: See the "Subsystems" section in CLAUDE.md's
Cycle Workflow Config for the full list and file mappings.

Example: /audit AI Processing & Analysis


Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context. Do not make any changes to any files during this session.
This session's audit scope: $ARGUMENTS
Use the Subsystems section of CLAUDE.md's Cycle Workflow Config to identify the relevant files for this subsystem. If the scope is ambiguous, ask before proceeding.

[OPTIONAL: PASTE ANY FOLLOW-ON AUDIT ITEMS FROM A PRIOR REGRESSION CHECK]

[IF TRIGGERED: PASTE ANY POLICY RESPONSE BLOCKS FROM THE LAST HEALTH SYNTHESIS — these are MANDATORY scope additions for this cycle]

[OPTIONAL: PASTE THE "RECOMMENDED FOCUS FOR NEXT SUBSYSTEM CYCLE" SECTION FROM THE LAST SEAMS & INVARIANTS AUDIT — if this subsystem was flagged, check the seam-related findings listed there before running the full audit]

Audit this scope thoroughly. Flag:

Bugs and logic errors
Dead or unused code (functions, variables, imports never called or referenced)
Missing or inadequate test coverage: behaviors that have no test, tests that assert stale behavior and would pass even if the code were broken, tautological tests that redefine constants locally instead of importing from production code
Stale TODOs, commented-out code, and placeholder logic left in production paths
Hardcoded values that should be config or environment variables
Security concerns specific to this module (auth gaps, unvalidated inputs, exposed sensitive data)
Inconsistencies between documentation/CLAUDE.md and actual implementation
Code quality issues: overly complex functions, poor separation of concerns, naming that obscures intent
Parallel sources of truth that can drift: schema definitions vs migration functions, Zod schemas vs TypeScript types, env var lists in docs vs startup validation, route definitions vs API docs. For anything with a "fresh install" path and an "existing install" path, verify both reach the same end state.
Startup ordering assumptions: any module that assumes an env var, table, service connection, or initialized singleton exists at boot that isn't guaranteed by the initialization sequence. Flag assumptions that would cause silent failure or degraded behavior rather than a hard crash.
Silent degradation on infrastructure mismatch: code paths where the app starts and reports healthy but is operating with broken or missing state — log lines that look like noise but indicate a real problem, health checks that return 200 while a subsystem is silently disabled, graceful fallbacks that mask a required dependency being absent.
Operator-only state: table seeds, feature flags, config values, or service connections that must be set manually outside of deployment and are not covered by startup validation, migration scripts, or documented runbooks. These are invisible to CI and easy to miss in new environments.
Anything that will compound into a larger problem if not addressed before this module scales

For each finding:

Assign an ID (F01, F02, F03...)
State the issue clearly in one or two sentences
Cite the file and approximate location (function name or line range)
Rate severity: Critical / High / Medium / Low
State your confidence level: High / Medium / Low (flag if you're inferring from limited context)
Add a rough effort signal for the fix: S (< 2 hours) / M (half-day to 2 days) / L (3+ days)

End with:

Top findings by impact — the 5 findings most likely to cause active breakage, data loss, or a security/compliance failure. Note: severity label and impact rank can differ.
Top 5 highest-leverage improvements (things that would most improve velocity or reliability if addressed)
Any dependencies or interactions with OTHER subsystems that this audit surfaced

Then produce a SESSION HANDOFF BLOCK:
---SESSION HANDOFF BLOCK---
Scope: $ARGUMENTS
Files covered: [comma-separated list]
Audit confidence: [High / Medium / Low overall, with any dimension-specific notes]
FINDINGS:
[ID] | [File: function/line] | [Severity] | [Confidence] | [Effort: S/M/L] | [One-line description]
(repeat for each finding)
CROSS-MODULE DEPENDENCIES SURFACED:

[module or file] depends on [specific function/export] in this scope — [nature of dependency]
(or "None identified")

TOP PRIORITIES:
Impact: [finding IDs — group related findings that should be fixed together, e.g. F03+F04+F05 (batch)]
High-leverage: [finding IDs]
RECOMMENDED PLANNING STARTING POINT: [one sentence — include why this ordering matters]
---END HANDOFF BLOCK---
