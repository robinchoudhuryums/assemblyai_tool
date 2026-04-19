# Coaching — backend follow-on roadmap

> Companion to the Coaching UI rewrite that shipped in commits
> `94853f0..` (installment 5 of the warm-paper design system). The UI is
> complete; the items below are the backend capabilities that would let
> us drop in missing sections of the design without inventing client-
> side approximations.
>
> Ordered by impact + how many surfaces they unlock. Pick and choose;
> nothing here blocks the shipped UI from being useful.

## F-C1 — Explicit `stage` column on `coaching_sessions`

**What:** Add a `stage` enum column (`open` / `plan` / `practice` /
`evidence` / `signed-off`) to `coaching_sessions`, plus a new endpoint
`POST /api/coaching/:id/advance` that moves the stage forward.

**Why:** The UI currently derives stage from `status + actionPlan`
completion (`deriveStage()` in
`client/src/components/coaching/primitives.tsx`). The split between
"plan" and "practice" is a heuristic on action-item completion ratio —
close enough for 90% of cases, but the prototype expected a real
lifecycle we can't reproduce. A real column lets managers nudge items
through the board without faking progress via action-item checkboxes.

**Unlocks:**
- Accurate board column bucketing (today's bucketing is one-stage-off
  for sessions where a manager marks items done without calling the
  session "in progress")
- A stage-advance button on the DetailPanel footer that's different
  from the status transitions (design intent: "Move to practice →")
- Backfill from current sessions is straightforward — map
  `deriveStage()` output once, then maintain the column live.

**Scope:** Small migration (~20 LOC), one new endpoint (~40 LOC), UI
swap in `primitives.tsx:deriveStage` + `manager-board.tsx` bucketing
+ `detail-panel.tsx` footer. Frontend tests in `primitives.test.ts`
stay valid; behavior is a superset.

---

## F-C2 — Team Skills Heatmap endpoint

**What:** `GET /api/coaching/team-competency-scores` returning
`{ agentId, category, avgScore, sampleSize, window: "30d" }[]`. Server
aggregates `analysis.subScores` from completed calls grouped by
employee and category.

**Why:** Manager Board design has a prominent "Team skills heatmap"
strip (agents × competencies grid, color-encoded by score). Skipped
in phase 4 — no endpoint exists. Without it, managers have no at-a-
glance view of "who needs what."

**Also unlocks:** Agent Inbox Competency Radar (right rail) — same
data source, different visualization. Shared query key so a single
fetch powers both.

**Scope:** ~100 LOC server (SQL aggregation + route), ~150 LOC client
(HeatmapStrip + CompetencyRadar components already visually
prototyped in `docs/design-bundle/project/coaching-{manager-board,
primitives}.jsx`). Category → competency mapping lives in
`client/src/components/coaching/primitives.tsx:CATEGORY_META`.

---

## F-C3 — Bulk action endpoints

**What:** Three new endpoints:
- `PATCH /api/coaching/bulk/status` body `{ ids: string[], status }` —
  bulk mark complete / dismiss
- `POST /api/coaching/bulk/assign` body `{ employeeIds, template }` —
  apply one coaching item to many agents (design calls this
  "team-wide bulk-assigned")
- `PATCH /api/coaching/bulk/reassign` body `{ ids, newEmployeeId }` —
  move items between agents

**Why:** Manager Board design has a sticky bulk-action bar that
appears when items are selected via checkboxes. Skipped in phase 4 —
no bulk endpoints, and the BoardCard checkbox UI was dropped with
them.

**Caveats:** Current audit-log infrastructure treats each coaching
mutation as a separate entry; bulk endpoints should emit one
composite `coaching_bulk_*` audit entry rather than N individual ones
to keep the HIPAA chain readable.

**Scope:** ~120 LOC server (three routes + bulk mutation helper in
`server/storage.ts`), ~100 LOC client (re-add BoardCard checkbox +
sticky bar UI from the prototype).

---

## F-C4 — Explicit `growthCopy` + `suggestedFix` fields

**What:** Add two optional TEXT columns to `coaching_sessions`:
- `growth_copy` — warm-framing sentence (the italic opener in the
  DetailPanel hero)
- `suggested_fix` — concrete "try this" advice (separate from
  action_plan)

**Why:** The current UI uses `growthCopyForCategory()` to serve a
canned per-category sentence when no stored value exists, and folds
`suggestedFix` into the action-plan list. Both work but lose a lot of
the design's voice. With real fields, the AssignModal gains a "Warm
framing" textarea that persists, and the DetailPanel has a dedicated
"Try this" section.

**AI integration:** the existing `coaching-alerts.ts` Bedrock call
can be extended to emit `growthCopy` + `suggestedFix` alongside the
action plan in the same single API call — no extra Bedrock cost.

**Scope:** Migration (~10 LOC), schema update in `shared/schema.ts`
(~15 LOC), server route validation tweak (~10 LOC), AI prompt update
in `coaching-alerts.ts` (~30 LOC), client wiring in
`assign-modal.tsx` + `detail-panel.tsx` (~60 LOC), fall back to
canned copy when the fields are null.

---

## F-C5 — `source` field + differentiated badges

**What:** Add `source` enum to `coaching_sessions`:
`ai` / `manager` / `cadence` / `self` / `theme`.

**Why:** `deriveSource()` heuristically reads `assignedBy` ("starts
with 'System'" → ai; else manager). It's lossy — there's no way to
tell a scheduled 1:1 from a theme assignment or an agent-flagged
item. The SourceBadge chip shows just two of the five designed
values today.

**Also unlocks:**
- "+ Self-flag something" CTA on the Agent Inbox (currently deferred —
  no agent-side POST to /api/coaching). Gate on `source === "self"`.
- Filter chip on the Manager Board by source (e.g., show only
  cadence-scheduled 1:1s for the week).

**Scope:** Migration (~5 LOC), schema + route updates (~25 LOC),
remove the heuristic from `primitives.tsx`, add self-flag flow to
AgentInbox (~80 LOC).

---

## F-C6 — Simulator-for-agents access

**What:** Broaden the existing `/admin/simulated-calls` feature (or
carve out a subset) so agents can use the simulator for coaching
practice — not full admin-level scenario authoring, but the ability
to run a pre-built scenario their coaching item links to.

**Why:** Design has a "Practice" section on the DetailPanel showing a
simulator scenario with duration + scenarios-completed progress bar
+ last-score display. Skipped entirely in phase 5 because the
simulator is admin-only and there's no schema field for the link.

**Pre-requisites (sub-tasks):**
1. Scenario library separate from the admin scenario generator —
   curated, agent-consumable scenarios tied to competencies
2. Coaching ↔ simulator link: `practice_scenario_id` column on
   `coaching_sessions`
3. Agent-facing simulator entry URL (gated by session, not role)
4. Store practice attempts with scores so the DetailPanel can show
   "2 of 3 scenarios completed · last score 8.4"

**Scope:** This is a feature, not a micro-task. Budget ≥1 cycle for
the scenario library work, maybe another cycle for the practice-
attempt tracking. Worth scoping into its own plan before touching
code.

---

## F-C7 — Outcome endpoint for viewers

**What:** Expose `GET /api/coaching/:id/outcome` to viewers (currently
manager+ only) with a filter: only the session's own assigned agent
can call it.

**Why:** DetailPanel "Evidence of change" section fetches this
endpoint only when `canManage=true`. Viewers see the same session
open the same panel but with no evidence — awkward gap.

**Caveats:** The outcome response includes per-sub-score deltas,
which are the agent's own data. HIPAA-wise, this is already
compatible with what the agent sees in `/api/my-performance`.

**Scope:** ~10 LOC server (route-level auth tweak), then drop the
`props.canManage === true` gate on the useQuery in
`detail-panel.tsx`.

---

## Dependency graph

```
F-C1 stage column ─────┐
                       ├─ unblocks polished stage-advance UX
F-C5 source field ─────┘

F-C2 heatmap endpoint ── unblocks 2 UI surfaces (board + inbox radar)

F-C3 bulk endpoints ─── unblocks bulk-action bar on board

F-C4 growth/fix fields ─ unblocks design voice + dedicated Try-this section

F-C6 simulator-for-agents ─ unblocks Practice section (independent, big)

F-C7 viewer outcome access ─ cosmetic but nice
```

Suggested picking order: F-C7 (trivial), F-C2 (highest visible
impact), F-C1 (accuracy), F-C4 (voice), F-C5 (semantic), F-C3
(workflow), F-C6 (standalone cycle).
