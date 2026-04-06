If $ARGUMENTS is empty AND there is no SESSION HANDOFF BLOCK visible earlier in this conversation, respond with exactly this and stop:

> **Usage (same session):** `/plan` — run immediately after `/audit` in the same session; the handoff block is already in context.
> **Usage (new session):** Paste the `---SESSION HANDOFF BLOCK---` from the audit session as the first message, then run `/plan`.

---

Do not make any changes to any files during this session.

The SESSION HANDOFF BLOCK above (produced in this session or pasted below) is your input. If running in the same session as /audit, proceed directly — the handoff block is already in context. If starting fresh, paste the handoff block before running this command.

$ARGUMENTS

Based on these findings, produce a prioritized action plan. Start from the RECOMMENDED PLANNING STARTING POINT in the handoff block.

For each action:
- Assign an Action ID (A1, A2, A3...)
- State what to do specifically — not "improve error handling" but "wrap mapAnalysis() decryption in try/catch, return a redacted sentinel on failure, and log the callId + error to the audit log"
- Group related findings into a single action where they share a root cause or fix location — use the + groupings from TOP PRIORITIES as your starting point
- Link back to the finding ID(s) addressed
- Estimate effort: Small (< 2 hours) / Medium (half-day to 2 days) / Large (3+ days)
- Classify cross-module risk:
  - Low: change is self-contained within this module
  - High: changes a function signature, export, or behavior that other modules depend on
  - Very High: changes a shared singleton, middleware, or auth/encryption path used across the entire app
- Note any prerequisites (actions that must complete first)

Organize the plan into:
1. Do immediately — critical issues, quick wins, or anything that blocks other work
2. Do this week — high-value improvements that are well-scoped
3. Defer but schedule — important but not urgent; needs planning or has dependencies

If this audit produced more than ~15 findings, split implementation actions into two batches: Batch 1 (P0/Critical + highest-compliance-risk items) and Batch 2 (everything else). Note the batch split in the handoff block.

Then provide:
- Any findings to escalate to the roadmap (too structural for a sprint)
- Architectural decisions needed before implementation — for each: the specific question, the options with tradeoffs, a recommendation, and whether to block implementation or proceed with a safe default now
- Any actions that would be good candidates for automation or scripting

Then produce a DOCUMENTATION UPDATE CHECKLIST:
[ ] CLAUDE.md — [what needs updating and why]
[ ] README — [what needs updating and why]
[ ] Inline code comments — [which files/functions]
[ ] Other: [filename] — [reason]
(omit any file that requires no changes)

Then produce an IMPLEMENTATION HANDOFF BLOCK:

---IMPLEMENTATION HANDOFF BLOCK---
Scope: [subsystem group name]
Systems map: in CLAUDE.md
Batch: [1 of 1 / 1 of 2 / 2 of 2 — omit if no batch split]

ACTIONS TO IMPLEMENT:
[ID] | [File: function/area] | [Effort] | [Risk] | [One-line description] | [Finding IDs] | [Prereqs]
(repeat for each action)

HIGH/VERY HIGH RISK ACTIONS — dep check required as Step 1 of implementation session:
[Action ID]: touches [specific export/interface] — depended on by [modules]
(or "None")

IMPLEMENT IN THIS ORDER: [ordered list of action IDs]
ORDERING RATIONALE: [1-2 sentences — why this order, which items must land together, whether high-risk items depend on low-risk items being committed first]
---END IMPLEMENTATION HANDOFF BLOCK---