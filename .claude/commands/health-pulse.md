Do not make any changes to any files during this session.
Refer to the systems map summary in CLAUDE.md under "## Systems Map" and PROJECT_HEALTH.md for prior scores and known issues.
$ARGUMENTS
Read CLAUDE.md, README, PROJECT_HEALTH.md, and any recently modified files to orient yourself.
Provide a Health Pulse — a directional snapshot of overall project standing. This is a quick check, not a benchmarkable score. Do not compare these scores to Health Synthesis scores from prior cycles.
For each dimension, provide:

A score out of 10
Confidence: High / Medium / Low
One sentence of reasoning
Flag any dimension where confidence is Low and a proper audit session is overdue

Dimensions: Overall, Architecture & Code Quality, Security & HIPAA Compliance, Audio Processing Pipeline, AI Analysis Reliability, AWS Integration Reliability, Data Integrity, Operational Readiness, Frontend & UX, Feature Completeness

AXIS B — HORIZONTAL (Bug-Shape Posture — lightweight scan):
For each category below, provide a quick directional score (1–10) and one sentence of evidence based on what you can observe from CLAUDE.md, recent commits, and code structure. These are lower-confidence than synthesis scores — flag that explicitly.

1. Silent Degradation — Are there .catch() blocks with default/fallback values in load-bearing paths? Does the app fail loudly or silently on missing state?
2. Startup Ordering — Does startup validation exist for env vars listed in CLAUDE.md? Any obvious middleware-ordering risks?
3. Operator-Only State Gaps — Are there manual setup steps in CLAUDE.md that have no automated validation?
4. Parallel Source-of-Truth Drift — Are there config values, types, or constants defined in multiple places?
5. Test Coverage Quality — Do recent fixes have corresponding regression tests, or are they untested?

Then answer:

Has anything changed significantly since the last assessment in PROJECT_HEALTH.md?
Is there any dimension that looks materially worse and warrants moving up in the audit queue?
What is the one thing most likely to cause a problem before the next full audit cycle?
Which Axis B category would you investigate first if you had one hour?
