Do not make any changes to any files yet. This session detects documentation drift and produces a specific update list.

$ARGUMENTS

Run these three checks in order. For each, state findings explicitly — do not summarize or skip steps.

---

CHECK 1 — CLAUDE.md "Known active issues" currency

Read CLAUDE.md and list every item in the "Known active issues" section.

For each item:
1. Read the relevant file(s) to verify whether the issue still exists as described
2. State: STILL PRESENT / RESOLVED / CHANGED (describe how it changed) / CANNOT VERIFY (explain why)

Then check the other sections of the CLAUDE.md systems map for any descriptions that conflict with the current state of the code:
- Module responsibilities that have changed
- Dependency relationships that have changed
- Data flow steps that are no longer accurate
- Any new modules, services, or patterns not mentioned

Produce a specific CLAUDE.md update list:
- Lines or sections to remove (resolved issues, stale descriptions)
- Lines or sections to update (changed behavior)
- Lines or sections to add (new patterns, new modules, newly discovered issues)

---

CHECK 2 — Subsystem file reference currency

Read .claude/commands/audit.md and find the SUBSYSTEM FILE REFERENCE table.

For each subsystem entry, verify:
1. Every file listed actually exists at the given path
2. There are no files in the relevant directories that are clearly part of that subsystem but missing from the list (read the actual directory listing)

Flag:
- Files listed that no longer exist (renamed or deleted)
- New files in those directories that should be in the reference
- Any directories that have been reorganized

Produce a specific audit.md update list with the exact changes needed to the SUBSYSTEM FILE REFERENCE table.

---

CHECK 3 — Recent implementation drift

If an IMPLEMENTATION SUMMARY BLOCK is available in this session (from $ARGUMENTS or earlier in context), check each changed file against CLAUDE.md:

For each file that was modified:
1. Does CLAUDE.md describe this file's module behavior?
2. Does the description still match the new behavior?
3. Should any "Known active issues" items be added or removed as a result?

If no implementation summary is provided, skip this check and note it was skipped.

---

FINAL OUTPUT

Produce two ready-to-apply update blocks:

CLAUDE.MD UPDATES:
[Exact text additions, removals, or replacements — formatted so you can apply them directly]

AUDIT.MD FILE REFERENCE UPDATES:
[Exact changes to the subsystem file reference table — formatted so you can apply them directly]

Then state: how many items need updating across both files, and which single change is most important to apply immediately.

After producing this output, ask: "Apply these changes now?" If yes, make all the changes described above. If no, leave files unchanged.