If $ARGUMENTS is empty or missing, respond with exactly this and stop:

Usage: /sync-commands <path-or-url-to-workflow-tools-repo>
Example: /sync-commands ../claude-workflow-tools
Example: /sync-commands https://github.com/robinchoudhuryums/claude-workflow-tools

---

Do not make any changes to any files until the comparison is complete.

Step 1: Read the template CLAUDE.md.
If $ARGUMENTS is a local path: read $ARGUMENTS/CLAUDE.md directly.
If $ARGUMENTS is a URL: fetch the raw CLAUDE.md from the repository.

Step 2: Read all command files in this project's .claude/commands/

Step 3: For each command file, compare against the corresponding
template in the workflow tools CLAUDE.md. Report:
- CURRENT: matches template
- OUTDATED: template has structural changes [list differences]
- MISSING: template exists but this project has no command file

Step 4: Verify this project's CLAUDE.md has a "Cycle Workflow Config"
section with: Test Command, Health Dimensions, Subsystems, Invariant
Library, and Policy Configuration. Flag any missing sections.

Step 5: For OUTDATED commands, produce the updated file content.
Commands are project-agnostic (they reference CLAUDE.md config),
so updates are direct copies — no merging needed.

Ask for approval before writing any files.
