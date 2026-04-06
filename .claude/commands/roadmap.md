If $ARGUMENTS is empty AND there is no recent audit output visible in this conversation, respond with exactly this and stop:

> **Usage:** `/roadmap` — run after 2–3 completed audit cycles.
> Optionally paste distilled findings from recent sessions as the argument for more grounded tier recommendations.
> **Example:** `/roadmap [paste compressed findings from recent audit sessions here]`

---

Do not make any changes to any files during this session.

Refer to the systems map summary in CLAUDE.md under "## Systems Map" for architectural context. Refer to PROJECT_HEALTH.md for current standing and prior cycle findings.

$ARGUMENTS

Based on the current state of the codebase and project documentation, produce a roadmap organized into four tiers. For tiers 1–3, ground every item in a specific finding, gap, or architectural reality from the audit or systems map. Do not include wishlist items that have no basis in what was actually found. For tier 4, you have explicit permission to be exploratory.

Tier 1 — Short-term (days to weeks):
- Specific bug fixes and tech debt items from recent audits
- Quick wins with outsized impact on stability or velocity
- Anything blocking other planned work

Tier 2 — Medium-term (weeks to months):
- Architectural improvements surfaced by the audit
- Feature completions or hardening of existing capabilities
- Integrations or enhancements with clear scope

Tier 3 — Long-term (months+):
- Systemic changes too large for a sprint but clearly necessary
- Scaling infrastructure if growth is expected
- Major new capability areas grounded in the project's direction

Tier 4 — Future possibilities (exploratory):
- How this project could evolve if the core worked perfectly
- Adjacent capabilities that would compound the value of what already exists
- Emerging patterns in the domain worth watching

For Tiers 1–3: provide 3–5 items each, with a one-line rationale and effort estimate.
For Tier 4: provide 3 distinct directions with a short paragraph each.

Flag any items where the right path forward depends on a business or product decision that hasn't been made yet.
Note which Tier 2 or 3 items would be significantly easier if Tier 1 items are addressed first.
End with: the one strategic bet you'd prioritize if resources were limited, and why.