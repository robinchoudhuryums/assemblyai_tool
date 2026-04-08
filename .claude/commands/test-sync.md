If $ARGUMENTS is empty AND there is no IMPLEMENTATION SUMMARY BLOCK visible earlier in this conversation, respond with exactly this and stop:

Usage: /test-sync — run after an implementation cycle to resolve CI failures.
Optionally paste an IMPLEMENTATION SUMMARY BLOCK or a list of failing test files as $ARGUMENTS to focus the session.
Example: /test-sync [paste Implementation Summary Block here]
This command should also be run when inheriting an existing codebase with pre-existing test failures, or when a significant refactor has left the test suite in a partially broken state.


Do not make changes to production code during this session. Changes in this session are limited to test files, test fixtures, and test configuration. If a test failure reveals a bug in production code rather than a test that needs updating, flag it but do not fix it — that belongs in an audit/plan/implement cycle.
Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context.
$ARGUMENTS
--- STEP 1: CLASSIFY ALL FAILURES ---
Run the full test suite. For every failing test, classify it into exactly one category before doing any fixing:
Category A — Stale assertion: the test was correct when written but production code intentionally changed behavior, and the test needs to be updated to assert the new correct behavior. These are fixable in this session.
Category B — Tautological test: the test redefines constants or mocks locally instead of importing from production code, so it passes even when production is broken. The test needs to be rewritten to actually test production behavior. Fixable in this session.
Category C — Pre-existing failure unrelated to recent changes: was failing before the recent implementation cycle and is not caused by any change made. Fixable in this session if the fix is well-scoped; flag for a dedicated audit if complex.
Category D — Test reveals an actual production bug: the test is correct and is catching a real regression or pre-existing bug introduced or exposed by recent changes. Do NOT fix in this session — flag as a follow-on audit item with the specific file and behavior. The production code fix belongs in an audit/plan/implement cycle.
Category E — Test infrastructure issue: flaky test, missing fixture, broken test environment configuration, import path error. Fixable in this session.
Produce a classification table before doing any work:
Test fileTest name/descriptionCategoryReason(one row per failing test)
State the total count per category. If any Category D failures exist, list them prominently — these represent real bugs that will remain after this session.
--- STEP 2: FIX CATEGORIES A, B, C, E ---
Work through fixable failures in this order: E first (unblock the test runner), then A (highest volume after an implementation cycle), then B (structural rewrites), then C (pre-existing if well-scoped).
For each fix:

State what the test originally asserted and why that was wrong or stale
State what it now correctly asserts
Confirm the new assertion actually reflects intended production behavior (not just making the test pass)

Category B tests (tautological) must always be rewritten in this session — a test that passes when production is broken is actively harmful and should not be left in place. Rewrite it to import constants and expected values from production code rather than redefining them locally.
Do not make a test pass by weakening its assertions. If the only way to make a test pass is to remove meaningful assertions, stop and classify it as Category D instead.
--- STEP 3: COVERAGE GAPS ---
After fixing failures, check whether any of the production code changes from the recent implementation cycle are covered by at least one test. Focus on:

Changed function signatures or return types
New error handling paths (especially graceful degradation changes)
New or modified data transformations
Any behavior change flagged in the Implementation Summary Block

For each gap found: describe what behavior is uncovered, note whether writing the test is simple (< 30 min, no new fixtures needed) or complex (requires significant fixture setup or cross-module mocking).
Implement simple coverage gaps immediately in this session. Do not just suggest them — write the test. Complex gaps go in FOLLOW-ON ITEMS with enough detail that they can be picked up in the next session without re-investigation.
--- STEP 4: CI CONFIGURATION CHECK ---
If CI is failing on checks beyond unit tests (linting, type checking, build), run each check and address failures in this order:

TypeScript compilation errors — fix if caused by this cycle's changes; flag pre-existing ones
ESLint errors — fix unused variables and obvious violations; flag anything requiring design decisions
Build failures — identify root cause and fix if straightforward; escalate if structural

--- FINAL OUTPUT ---
Produce a TEST SYNC SUMMARY:
---TEST SYNC SUMMARY---
Session scope: test suite sync after [subsystem] implementation cycle
Tests fixed: [count and categories]
Tests not fixed — Category D (production bugs): [list with file and behavior description]
FIXES APPLIED:
[Test file] | [Category] | [What changed and why]
(repeat for each fixed test, including newly written coverage tests)
COVERAGE GAPS — IMPLEMENTED:
[Behavior covered] | [Test file] | [What the test asserts]
(or "None")
COVERAGE GAPS — DEFERRED (complex, needs fixtures):
[Behavior] | [Why deferred] | [What's needed to implement]
(or "None")
CI STATUS AFTER THIS SESSION:
[Expected passing / Still failing on Category D items / Other blockers remaining]
FOLLOW-ON ITEMS FOR AUDIT/PLAN/IMPLEMENT:
[Any Category D bugs that need a proper fix cycle]
(or "None")
---END TEST SYNC SUMMARY---
