# CallAnalyzer — Project Health

**Last updated**: 2026-04-06
**Last full systems map**: 2026-04-06

## Current Standing

No formal audit cycles have been completed yet. The systems map in CLAUDE.md was constructed from a five-phase analysis of entry points, module headers, data flow tracing, and verified dependency mapping.

## Known Active Issues

- `server/services/rag-hybrid.ts` is dead code — not imported by any production file (only referenced in tests)
- `server/services/telephony-8x8.ts` is a stub pending 8x8 API access clarification
- `server/services/scheduled-reports.ts` exists but is undocumented in API routes or CLAUDE.md
- `@replit/vite-plugin-*` packages in devDependencies are unused (removed from vite.config.ts but not from package.json)
- Improvement roadmap (`docs/improvement-roadmap.md`) has stale entries: "Structured observability" and "correlation IDs" listed as TODO but already implemented
- Manual SQL in `storage-postgres.ts` without query builder (acknowledged in roadmap as multi-sprint effort)

## Audit History

| Date | Scope | Findings | Status |
|------|-------|----------|--------|
| — | No audits completed yet | — | — |

## Health Pulse History

| Date | Overall | Architecture | Security | Pipeline | AI | AWS | Data | Ops | Frontend | Features |
|------|---------|-------------|----------|----------|----|-----|------|-----|----------|----------|
| — | No pulses recorded yet | — | — | — | — | — | — | — | — | — |
