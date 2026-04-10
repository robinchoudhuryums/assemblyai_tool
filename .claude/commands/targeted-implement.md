If $ARGUMENTS is empty or missing AND no TIER 2 HANDOFF BLOCK exists earlier in this session, respond with exactly this and stop:

Usage (same session): /targeted-implement — run immediately after /targeted-audit in the same session; the handoff block is already in context.
Usage (new session): Paste the ---TIER 2 HANDOFF BLOCK--- from the audit session as the first message, then run /targeted-implement.

---

Read CLAUDE.md (especially Common Gotchas) before starting.

You are implementing the actions from the TIER 2 HANDOFF BLOCK above. Rules:

- Implement ONLY the actions in the handoff block, in the order listed
- Do not fix, refactor, or improve anything outside this scope even if
  you notice issues — note them at the end instead
- If an action is more complex than estimated, stop and describe what
  you found before continuing
- If an action requires touching files in the DO NOT TOUCH list or
  outside the listed scope, stop and flag it
- After each action, briefly note: what changed, files touched, anything
  unexpected
- Check Common Gotchas before each action to avoid re-introducing known issues
- Run tests after completing all actions if a test command is available

After all actions are complete (or if you had to stop), do the following in order:

1. RUN TESTS
Run the test suite (npm test). Note the result. If tests fail, classify:
- Caused by this session's changes (fix now)
- Pre-existing (note but don't fix)
- Real production bug exposed by correct test (flag as follow-on)

2. REGRESSION CHECK
Review every file you modified. For each change:
- Could this change break any caller or consumer of this function/export?
- Did you change any interface, return type, or default value that other
  modules depend on?
- Is there any scenario where the old behavior was actually correct and
  you've made it worse?
Cross-reference the CROSS-MODULE RISKS section from the handoff block.
List any risks found, even low-probability ones.

3. REFLECT
For each action completed:
a) Would this bug have actually fired in production this month?
   YES (describe trigger) or NO (why not)
b) Did this action introduce a new failure mode, documented or not?
   YES (describe it) or NO

Tally: [production fixes] − [new failure modes] = [net score]

4. INVARIANT CHECK
Check whether any changes could have violated invariants from the project's
invariant library (listed in CLAUDE.md Common Gotchas). List any at risk:
- [invariant description] — [which change could affect it] — [risk: High/Med/Low]
Or: "No invariants at risk."

5. INVARIANT CANDIDATES
What rules must now hold as a result of this session's changes that
should be checked in the future? List as:
- [one-sentence rule] | [file/function it applies to]

6. SUMMARY
Produce a TARGETED IMPLEMENTATION SUMMARY:

---TARGETED IMPLEMENTATION SUMMARY---
Scope: [subsystem from handoff block]
Actions completed: [list action IDs]
Actions not completed (if any): [list with reason]
Files modified: [list all files touched]

CHANGES:
[Action ID] | [File(s)] | [What changed] | [Findings addressed]
(repeat for each)

TEST RESULTS: [passed/failed — details if failed]

REGRESSION RISKS:
[any risks from the regression check, or "None"]

INVARIANTS AT RISK:
[any invariants potentially affected, or "None"]

NET SCORE: [production fixes] − [new failure modes] = [net]

INVARIANT CANDIDATES:
[new rules to add to the library, or "None"]

FOLLOW-ON ITEMS:
- [File: area] — [what to check and why]
(or "None")

DOCUMENTATION UPDATES NEEDED:
- [any CLAUDE.md, README, or inline doc changes needed]
(or "None")
---END TARGETED IMPLEMENTATION SUMMARY---

After the summary, suggest running /test-sync if any test failures remain, and /sync-docs if any documentation updates are needed.
