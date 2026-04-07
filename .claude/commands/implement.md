If $ARGUMENTS is empty or missing, respond with exactly this and stop:

Usage: /implement <paste Implementation Handoff Block here>
Paste the full ---IMPLEMENTATION HANDOFF BLOCK--- output from the /plan command as the argument, or paste it as the first message in this session before running /implement.
The handoff block must include: Scope, ACTIONS TO IMPLEMENT, HIGH/VERY HIGH RISK ACTIONS, and IMPLEMENT IN THIS ORDER.


Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context.
$ARGUMENTS
The implementation handoff block above is the agreed scope for this session.
--- STEP 1: DEPENDENCY CHECK ---
Review the HIGH/VERY HIGH RISK ACTIONS listed in the handoff block.
For each one:

Identify every file outside the current scope that imports from, calls into, or depends on the specific functions, modules, or data structures being changed
Describe what would break or need updating if the change proceeds as described
For each risk, explicitly confirm whether it is real or negated by other factors (cascade configs, zero callers, idempotent operations, existing indexes). Don't just list risks — validate them.
Confirm the implementation order accounts for these dependencies

If no actions are rated High or Very High, state that explicitly and proceed to Step 2.
--- STEP 2: IMPLEMENTATION ---
Rules:

Implement only the actions listed. Do not fix or refactor anything outside this scope. Flag other issues at the end.
Work through actions in the implementation order from the handoff block unless a blocker requires reordering — if so, say why before reordering.
Before implementing any High or Very High risk action, confirm your understanding of the change and its intended effect. Wait for acknowledgement before proceeding.
If a finding is more complex than the effort estimate suggested, stop and describe what you found. Do not improvise a larger solution without discussion.
If an action requires touching files outside the listed scope, stop and flag it rather than proceeding.
After completing each action: what changed, which file(s) were touched, anything unexpected.

When all actions are complete, proceed to Step 3 before producing the summary.
--- STEP 3: TEST SUITE CHECK ---
Run the full test suite (or the most relevant subset if a full run is prohibitively slow). Categorize every failure:
Category A — Caused by this cycle's changes: tests that were passing before and now fail because this session intentionally changed behavior. These are IN SCOPE — fix them now. Updating a test to match intentionally changed behavior is part of completing the action.
Category B — Pre-existing failures: tests that were already failing before this session's changes. These are OUT OF SCOPE — list them in the summary but do not fix them.
Category C — Coverage gaps revealed: areas where new code was added or behavior changed but no test covers the new path. Note them in FOLLOW-ON ITEMS.
Fix all Category A failures. For each fix: note what the test originally asserted, why it was wrong given the new behavior, and what it now correctly asserts.
If the test suite cannot be run in this environment, state that explicitly and list every file changed in Step 2 alongside the test files most likely to need updating — leave fixing them as a follow-on item with high priority.
Then produce an IMPLEMENTATION SUMMARY BLOCK:
---IMPLEMENTATION SUMMARY BLOCK---
Session scope: [subsystem group]
Actions completed: [list action IDs]
Actions not completed (if any): [list with reason]
CHANGES MADE:
[Action ID] | [File(s) modified] | [Brief description of what changed] | [Finding IDs resolved]
(repeat for each completed action)
TEST SUITE RESULTS:
Category A (fixed — caused by this cycle): [test file(s) and what changed, or "None"]
Category B (pre-existing — not fixed): [test file(s) and failure description, or "None"]
Category C (coverage gaps — follow-on): [what's uncovered, or "None"]
CI status after fixes: [passing / failing on Category B only / could not run]
UNEXPECTED FINDINGS DURING IMPLEMENTATION:

[anything discovered that wasn't in the audit — new issues, hidden complexity, etc.]
(or "None")

FOLLOW-ON ITEMS:

[anything to add to the planning backlog or escalate to the roadmap]
(or "None")

DOCUMENTATION UPDATES NEEDED:

[any CLAUDE.md, README, or inline docs to update]
(or "None")
---END IMPLEMENTATION SUMMARY BLOCK---
