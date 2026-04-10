Do not make any changes to any files. The regression check above is complete — now provide an honest post-cycle assessment.

$ARGUMENTS

For each action completed this cycle, answer two questions:

1. "Would this bug have actually fired in production this month?"
   Answer YES (real production bug — currently-reachable code path, realistic load, active user scenario) or NO (speculative, defensive, future-proofing, dead code, or zero-caller path).
   Be specific: if YES, describe the trigger scenario. If NO, say why it wouldn't have fired.

2. "Did this action introduce a new failure mode, documented or not?"
   Answer YES or NO. If YES: describe the new failure mode, whether it is better or worse than what it replaced, and under what conditions it would fire. Do not bury this in a "tradeoffs" section — if the post-cycle state is worse under any realistic scenario, that is a regression and must be counted as one.

Tally:
- Production bug fixes (YES to question 1): [count]
- Speculative/defensive fixes (NO to question 1): [count]
- Actions that introduced new failure modes (YES to question 2): [count]
- Net score: [production fixes] − [new failure modes] = [net]

Flag any fixes that introduced tradeoffs or new failure modes — cases where the new behavior is better in aggregate but worse in specific scenarios. Note what failure mode was replaced and what new one was introduced.

Honest impact summary — answer each directly:
- What actually changed for a user of this application right now?
- What changed for the next developer working in this subsystem?
- What became safer under scale or concurrent load that wasn't safe before?
- Was any effort spent on dead code, zero-caller paths, or future-proofing that won't be exercised for months?

Invariant growth — answer this:
- "What invariants does this cycle establish that the next Verification Pass should probe?"
  List any rules that must now hold as a result of this cycle's changes. These become candidates for the invariant library. Format each as: [proposed ID] | [one-sentence rule] | [which subsystem/seam it guards] | [how to verify: code read, test, or assertion]

End with:
- One sentence: the single most structurally significant change in this cycle
- One sentence: the finding that should have been deferred — lowest practical impact relative to implementation cost
- Any actions where a design decision produced a tradeoff worth documenting in CLAUDE.md

After completing the reflection, state:
"Run /sync-docs to check whether CLAUDE.md and the audit.md subsystem file reference have drifted based on the changes made this cycle. Recommended if any of the following were true this cycle: a module's behavior changed, a new file was added or deleted, a known issue was resolved, or a new pattern was introduced."
