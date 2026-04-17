# Simulated Call Generator — Preset Scripts

12 preset call scripts (4 scenarios × 3 quality tiers: `poor`, `acceptable`,
`excellent`) used to seed the `simulated_calls` catalog.

Voice IDs use ElevenLabs default preset voices available on every account:

| Role     | Voice  | ID                        |
|----------|--------|---------------------------|
| agent    | Adam   | pNInz6obpgDQGcFmaJgB      |
| customer | Rachel | 21m00Tcm4TlvDq8ikWAM      |

Admins can override voices per-generation from the Script Builder UI.

Scenarios cover common UMS call categories:

1. **CPAP order status / authorization delay** — inbound status check
2. **Power Wheelchair billing dispute** — invoice discrepancy
3. **Oxygen Concentrator malfunction** — troubleshooting
4. **CGM eligibility / benefits** — coverage question

Each script is short (6-10 turns) to keep TTS cost ~$1 per generation.
