If $ARGUMENTS is empty or missing, respond with exactly this and stop:

> **Usage:** `/implement <paste Implementation Handoff Block here>`
> Paste the full `---IMPLEMENTATION HANDOFF BLOCK---` output from the `/plan` command as the argument, or paste it as the first message in this session before running `/implement`.
> The handoff block must include: Scope, ACTIONS TO IMPLEMENT, HIGH/VERY HIGH RISK ACTIONS, and IMPLEMENT IN THIS ORDER.

---

Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context.

$ARGUMENTS

The implementation handoff block above is the agreed scope for this session.

--- STEP 1: DEPENDENCY CHECK ---
Review the HIGH/VERY HIGH RISK ACTIONS listed in the handoff block.
For each one:
1. Identify every file outside the current scope that imports from, calls into, or depends on the specific functions, modules, or data structures being changed
2. Describe what would break or need updating if the change proceeds as described
3. For each risk, explicitly confirm whether it is real or negated by other factors (cascade configs, zero callers, idempotent operations, existing indexes). Don't just list risks — validate them.
4. Confirm the implementation order accounts for these dependencies

If no actions are rated High or Very High, state that explicitly and proceed to Step 2.

--- STEP 2: IMPLEMENTATION ---

Rules:
- Implement only the actions listed. Do not fix or refactor anything outside this scope. Flag other issues at the end.
- Work through actions in the implementation order from the handoff block unless a blocker requires reordering — if so, say why before reordering.
- Before implementing any High or Very High risk action, confirm your understanding of the change and its intended effect. Wait for acknowledgement before proceeding.
- If a finding is more complex than the effort estimate suggested, stop and describe what you found. Do not improvise a larger solution without discussion.
- If an action requires touching files outside the listed scope, stop and flag it rather than proceeding.
- After completing each action: what changed, which file(s) were touched, anything unexpected.

When all actions are complete, produce an IMPLEMENTATION SUMMARY BLOCK:

---IMPLEMENTATION SUMMARY BLOCK---
Session scope: [subsystem group]
Actions completed: [list action IDs]
Actions not completed (if any): [list with reason]

CHANGES MADE:
[Action ID] | [File(s) modified] | [Brief description of what changed] | [Finding IDs resolved]
(repeat for each completed action)

UNEXPECTED FINDINGS DURING IMPLEMENTATION:
- [anything discovered that wasn't in the audit — new issues, hidden complexity, etc.]
(or "None")

FOLLOW-ON ITEMS:
- [anything to add to the planning backlog or escalate to the roadmap]
(or "None")

DOCUMENTATION UPDATES NEEDED:
- [any CLAUDE.md, README, or inline docs to update]
(or "None")
---END IMPLEMENTATION SUMMARY BLOCK---