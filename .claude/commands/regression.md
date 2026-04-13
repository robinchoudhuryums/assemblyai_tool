If $ARGUMENTS is empty AND there is no IMPLEMENTATION SUMMARY BLOCK visible earlier in this conversation, respond with exactly this and stop:

> **Usage (same session):** `/regression` — run at the end of the same implementation session; the summary block is already in context.
> **Usage (new session):** Paste the `---IMPLEMENTATION SUMMARY BLOCK---` as `$ARGUMENTS` or as the first message in this session, then run `/regression`.

---

Do not make any changes to any files during this session.

Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context. The IMPLEMENTATION SUMMARY BLOCK above (from this session) describes what was changed.

$ARGUMENTS

Based on the systems map and your knowledge of the codebase:

1. Identify which modules outside the changed scope could have been affected by these changes
2. For each, describe specifically what could have broken and where to verify (file and function/area)
3. For each risk item, explicitly confirm whether the risk materialized or was negated by other factors — cascade configs, zero callers, idempotent operations, existing indexes, default values. Don't just list risks; validate them.
4. Flag anything that warrants a targeted re-audit of the dependent module before the next implementation session
5. Cross-reference against the project's invariant library (listed in the Invariant Library section of CLAUDE.md's Cycle Workflow Config). Check whether any changes could have violated these invariants. List any at risk:
   - [INV-ID or description] — [which change could affect it] — [risk level: High/Med/Low]
   If no invariants are at risk, state "No invariants at risk."
6. Note any documentation (CLAUDE.md, README, roadmap) that should be updated to reflect these changes

Prioritize the verification list by likelihood of breakage. Then produce a FOLLOW-ON AUDIT ITEMS block:

---FOLLOW-ON AUDIT ITEMS---
- [File: function/area] — [what to check, why it was flagged, which change surfaced it]
(repeat for each item, or "None")
---END FOLLOW-ON AUDIT ITEMS---
