Do not make any changes to any files during this session.

You are setting up the cycle workflow configuration for this project.
This is the foundation for all future audit, implementation, and
verification work — accuracy here compounds across every cycle.

Read these files carefully in this order:
1. CLAUDE.md (if it exists — especially Common Gotchas, Key Design Decisions)
   If CLAUDE.md does not exist yet, skip and note that Common Gotchas
   and invariants will be populated after the first audit cycle.
2. README
3. Package manifest (package.json)
4. All entry points (server/index.ts, client main, route registration)
5. Database schema files
6. Test configuration and existing test files

Then run all five phases from the setup-cycle workflow:
Phase 1: Foundation Read → PROJECT PROFILE
Phase 2: Module & Dependency Analysis → HIGH-FAN-OUT MODULES, COUPLING CLUSTERS
Phase 3: Subsystem Boundary Proposal → subsystem groupings with quality checks
Phase 4: Health Dimensions & Policy → domain-specific dimensions, policy threshold
Phase 5: Invariant Extraction → 15-25 invariants from gotchas, decisions, code patterns

Output a Cycle Workflow Config section formatted for CLAUDE.md:

## Cycle Workflow Config

### Test Command
[detected test command]

### Health Dimensions
[comma-separated]

### Subsystems
[Name]:
  [file list]

### Invariant Library
INV-XX | [rule] | Subsystem: [name]

### Policy Configuration
Policy threshold: [N]/10
Consecutive cycles: [N]

Also output a rotation plan and confidence assessment.
