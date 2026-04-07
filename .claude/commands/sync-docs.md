Do not make any changes to any files yet. This session detects documentation drift and produces a specific update list.
$ARGUMENTS
Run these four checks in order. For each, state findings explicitly — do not summarize or skip steps.

CHECK 1 — CLAUDE.md "Known active issues" currency
Read CLAUDE.md and list every item in the "Known active issues" section.
For each item:

Read the relevant file(s) to verify whether the issue still exists as described
State: STILL PRESENT / RESOLVED / CHANGED (describe how it changed) / CANNOT VERIFY (explain why)

Then check the other sections of the CLAUDE.md systems map for any descriptions that conflict with the current state of the code:

Module responsibilities that have changed
Dependency relationships that have changed
Data flow steps that are no longer accurate
Any new modules, services, or patterns not mentioned

Produce a specific CLAUDE.md update list:

Lines or sections to remove (resolved issues, stale descriptions)
Lines or sections to update (changed behavior)
Lines or sections to add (new patterns, new modules, newly discovered issues)


CHECK 2 — Subsystem file reference currency
Read .claude/commands/audit.md and find the SUBSYSTEM FILE REFERENCE table.
For each subsystem entry, verify:

Every file listed actually exists at the given path
There are no files in the relevant directories that are clearly part of that subsystem but missing from the list (read the actual directory listing)

Flag:

Files listed that no longer exist (renamed or deleted)
New files in those directories that should be in the reference
Any directories that have been reorganized

Produce a specific audit.md update list with the exact changes needed to the SUBSYSTEM FILE REFERENCE table.

CHECK 3 — Operator-only state inventory
Scan the codebase for state that must exist before the app functions correctly but is not created or validated by any automated path (migrations, startup validation, CI, seed scripts).
Look for:

Database tables that require manual seed data to function (lookup tables, feature flag rows, config rows, default template records)
Feature flags or config values read at runtime that have no default and no startup check
Third-party service credentials or tokens referenced in code but not in startup env validation
Any comment, README section, or TODO referencing "must be set manually", "run this script first", "set in production", or similar
Startup log lines that warn about missing state but allow the app to continue (these are silent degradation points — the app appears healthy but isn't)

For each item found:

Describe what must exist and what breaks if it doesn't
Check whether it's documented anywhere (CLAUDE.md, README, runbook, migration comment)
Rate its deployment risk: High (app silently broken without it), Medium (feature disabled), Low (cosmetic/optional)

Produce a specific OPERATOR STATE CHECKLIST:
[ ] [What must exist] — [where it's needed] — [deployment risk: High/Medium/Low] — [currently documented: yes/no/partial]
(repeat for each item, or "None identified")

CHECK 4 — Recent implementation drift
If an IMPLEMENTATION SUMMARY BLOCK is available in this session (from $ARGUMENTS or earlier in context), check each changed file against CLAUDE.md:
For each file that was modified:

Does CLAUDE.md describe this file's module behavior?
Does the description still match the new behavior?
Should any "Known active issues" items be added or removed as a result?

If no implementation summary is provided, skip this check and note it was skipped.

FINAL OUTPUT
Produce three ready-to-apply update blocks:
CLAUDE.MD UPDATES:
[Exact text additions, removals, or replacements — formatted so you can apply them directly]
AUDIT.MD FILE REFERENCE UPDATES:
[Exact changes to the subsystem file reference table — formatted so you can apply them directly]
OPERATOR STATE CHECKLIST:
[Items from Check 3 requiring documentation or automation — formatted as a deployment runbook checklist]
(or "None identified")
Then state: how many items need updating across all outputs, and which single change is most important to apply immediately.
After producing this output, ask: "Apply these changes now?" If yes, make all the changes described above. If no, leave files unchanged.
