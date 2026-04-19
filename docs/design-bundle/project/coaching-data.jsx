// Coaching items — mix of AI-detected, manager-assigned themes, scheduled 1:1s.
// Lifecycle: open → plan → practice → evidence → signed-off  (plus 'watching' for regression)

// Competencies that coaching items roll up under
const COMPETENCIES = [
  { id:'empathy',    label:'Empathy',            hue:340, icon:'◐' },
  { id:'compliance', label:'Compliance',         hue: 30, icon:'◇' },
  { id:'discovery',  label:'Discovery',          hue:210, icon:'◎' },
  { id:'product',    label:'Product Knowledge',  hue:155, icon:'◉' },
  { id:'close',      label:'Closing & Commit',   hue: 55, icon:'◈' },
  { id:'pace',       label:'Pace & Silence',     hue:270, icon:'◑' },
];

// Per-agent competency scores (0-100), with short trend
// Some agents only for variety; Alex (e1) is the "you" if role=agent
const COMPETENCY_SCORES = {
  e1: { empathy:82, compliance:71, discovery:68, product:88, close:74, pace:63,
        trend:{ empathy:[72,74,76,78,80,82], compliance:[68,70,70,69,71,71], discovery:[58,60,62,65,67,68], product:[82,84,86,87,88,88], close:[70,71,72,72,74,74], pace:[55,57,58,60,62,63] } },
  e2: { empathy:88, compliance:92, discovery:84, product:90, close:86, pace:80, trend:{} },
  e3: { empathy:64, compliance:58, discovery:62, product:76, close:60, pace:70, trend:{} },
  e4: { empathy:78, compliance:74, discovery:70, product:80, close:72, pace:68, trend:{} },
  e5: { empathy:56, compliance:48, discovery:58, product:68, close:54, pace:50, trend:{} },
  e6: { empathy:84, compliance:86, discovery:82, product:86, close:84, pace:78, trend:{} },
  e7: { empathy:76, compliance:78, discovery:72, product:82, close:76, pace:74, trend:{} },
  e8: { empathy:70, compliance:66, discovery:74, product:78, close:68, pace:72, trend:{} },
};

// Coaching item source types
// 'ai' = auto-detected, 'theme' = manager assigned as a general theme, 'cadence' = scheduled 1:1/weekly review
// 'self' = agent self-logged (keep a couple for completeness even if not in picked origins)

const mkItem = (o) => ({
  stage: 'open',
  createdDaysAgo: 3,
  dueDaysAway: 7,
  practice: null,
  evidence: null,
  signedOff: false,
  ...o,
});

// Stages: open, plan, practice, evidence, signed-off
// growthCopy: warm framing — appears as title cap

const ITEMS = [
  // -------- Alex Rivera (e1) — primary agent view --------
  mkItem({
    id:'co-101',
    agentId:'e1', assignedBy:'manager', assignedByName:'Jordan Kim',
    source:'ai',
    competency:'discovery',
    title:'Slow down on intake questions',
    growthCopy:'A chance to let patients breathe between questions.',
    issue:'On 4 recent CPAP intake calls, you moved through the pre-auth checklist in under 60 seconds. Patients asked for repeats on 3 of them.',
    evidenceCall:{ id:'c196', at:'Today · 09:22', topic:'Status check', clip:'02:14 – 02:58', sentimentShift:-0.4 },
    suggestedFix:'Try a 2-beat pause after each question. "Take your time" is a cheat code.',
    practiceLink:{ type:'simulator', scenario:'Elderly patient, first CPAP, easily overwhelmed', duration:'~8 min' },
    stage:'practice',
    createdDaysAgo:5,
    dueDaysAway:4,
    practice:{ scenariosCompleted:2, targetScenarios:3, lastScore:8.4 },
  }),
  mkItem({
    id:'co-102',
    agentId:'e1', assignedBy:'ai', assignedByName:'CX Analyst',
    source:'ai',
    competency:'compliance',
    title:'HIPAA — verify DOB before discussing orders',
    growthCopy:'Small habit, big protection.',
    issue:'On 2 calls this week you referenced order details before completing DOB verification.',
    evidenceCall:{ id:'c195', at:'Today · 08:58', topic:'Oxygen setup consult', clip:'00:42 – 01:15', sentimentShift:0 },
    suggestedFix:'Say the verification line before opening the record. A sticky-note by your monitor works wonders.',
    practiceLink:{ type:'reading', scenario:'HIPAA micro-refresher', duration:'3 min' },
    stage:'open',
    createdDaysAgo:1,
    dueDaysAway:6,
  }),
  mkItem({
    id:'co-103',
    agentId:'e1', assignedBy:'manager', assignedByName:'Jordan Kim',
    source:'theme',
    competency:'close',
    title:'End every call with a clear next step',
    growthCopy:'Close with clarity — patients leave feeling taken care of.',
    issue:'A theme across the team — 38% of calls end without an explicit "here\'s what happens next." Yours is 31%.',
    evidenceCall:null,
    suggestedFix:'Three sentences: what I\'m doing, when you\'ll hear back, what you should do if you don\'t.',
    practiceLink:{ type:'simulator', scenario:'Three closing scripts, your choice', duration:'~5 min' },
    stage:'evidence',
    createdDaysAgo:14,
    dueDaysAway:-2,
    practice:{ scenariosCompleted:3, targetScenarios:3, lastScore:9.1 },
    evidence:{ callId:'c201', note:'Closed with explicit next step, patient confirmed understanding.', score:9.2 },
  }),
  mkItem({
    id:'co-104',
    agentId:'e1', assignedBy:'cadence', assignedByName:'Weekly review',
    source:'cadence',
    competency:'empathy',
    title:'Weekly review — acknowledge before solving',
    growthCopy:'Patients feel heard when you name the hard part first.',
    issue:'On your 3 lowest-sentiment calls this week, the first response to a complaint was a solution, not an acknowledgment.',
    evidenceCall:{ id:'c196', at:'Today · 09:22', topic:'Status check', clip:'01:08 – 01:34', sentimentShift:-0.3 },
    suggestedFix:'"That\'s frustrating, I\'m sorry you\'re dealing with this" — 8 words, changes the whole call.',
    practiceLink:{ type:'simulator', scenario:'Acknowledgment-first opener, 4 situations', duration:'~10 min' },
    stage:'plan',
    createdDaysAgo:0,
    dueDaysAway:7,
  }),
  mkItem({
    id:'co-105',
    agentId:'e1', assignedBy:'self', assignedByName:'Alex Rivera',
    source:'self',
    competency:'product',
    title:'Want help: newer CGM sensor troubleshooting',
    growthCopy:'Good instinct to flag this — the new sensors are tricky.',
    issue:'I\'ve had two calls this week where I wasn\'t sure of the right escalation path for G7 sensor errors. Would love a reference or quick practice.',
    evidenceCall:null,
    suggestedFix:null,
    practiceLink:{ type:'reading', scenario:'G7 decision tree (internal doc)', duration:'6 min' },
    stage:'open',
    createdDaysAgo:2,
    dueDaysAway:10,
  }),
  mkItem({
    id:'co-106',
    agentId:'e1', assignedBy:'manager', assignedByName:'Jordan Kim',
    source:'cadence',
    competency:'pace',
    title:'1:1 Monday — fill silence gracefully',
    growthCopy:'Silence is okay. You can let it breathe.',
    issue:'Scheduled for your Monday 1:1. Three clips queued for review.',
    evidenceCall:null,
    suggestedFix:null,
    practiceLink:null,
    stage:'open',
    createdDaysAgo:0,
    dueDaysAway:3,
  }),

  // -------- Team items (for manager board) --------
  mkItem({ id:'co-201', agentId:'e2', assignedBy:'ai', source:'ai', competency:'close',
    title:'Offer proactive follow-up on escalations',
    growthCopy:'You already do this on easy calls — bring it to the hard ones.',
    issue:'Two of three escalated calls ended without a commitment.', stage:'open', createdDaysAgo:3, dueDaysAway:5 }),
  mkItem({ id:'co-202', agentId:'e3', assignedBy:'manager', assignedByName:'Jordan Kim', source:'ai', competency:'empathy',
    title:'Acknowledge emotion before process',
    growthCopy:'Slow down when patients are upset.', issue:'Escalated call, sentiment dropped 0.8 at 03:44.',
    evidenceCall:{ id:'c198', at:'Today · 09:48', topic:'Eligibility — escalated', clip:'03:44 – 04:12', sentimentShift:-0.8 },
    stage:'plan', createdDaysAgo:1, dueDaysAway:6 }),
  mkItem({ id:'co-203', agentId:'e3', assignedBy:'ai', source:'ai', competency:'discovery',
    title:'Ask open-ended questions first',
    growthCopy:'Discovery is faster when it doesn\'t feel like a quiz.', issue:'Intake calls average 2.1 yes/no questions before an open-ended one.',
    stage:'open', createdDaysAgo:4, dueDaysAway:3 }),
  mkItem({ id:'co-204', agentId:'e5', assignedBy:'ai', source:'ai', competency:'compliance',
    title:'HIPAA — verify DOB before discussing orders',
    growthCopy:'Two calls this week — let\'s lock this in.', issue:'Verification skipped on 2 of 5 oxygen intake calls.',
    evidenceCall:{ id:'c195', at:'Today · 08:58', topic:'Oxygen setup consult', clip:'00:42 – 01:15', sentimentShift:0 },
    stage:'practice', createdDaysAgo:6, dueDaysAway:1,
    practice:{ scenariosCompleted:1, targetScenarios:3, lastScore:7.0 } }),
  mkItem({ id:'co-205', agentId:'e5', assignedBy:'manager', assignedByName:'Jordan Kim', source:'cadence',
    competency:'pace', title:'1:1 Tuesday — long silences on complaint calls',
    growthCopy:'Let\'s work through two clips together.', issue:'Two complaint calls had 14+ second silences.',
    stage:'open', createdDaysAgo:0, dueDaysAway:4 }),
  mkItem({ id:'co-206', agentId:'e4', assignedBy:'ai', source:'ai', competency:'close',
    title:'End every call with a clear next step',
    growthCopy:'Team theme — let\'s all do this.', issue:'Theme rollup — your close-rate is 68%, team avg 72%.',
    stage:'evidence', createdDaysAgo:10, dueDaysAway:-1,
    practice:{ scenariosCompleted:3, targetScenarios:3, lastScore:8.6 },
    evidence:{ callId:'c189', note:'Clean close, patient confirmed understanding.', score:8.6 } }),
  mkItem({ id:'co-207', agentId:'e6', assignedBy:'cadence', source:'cadence', competency:'product',
    title:'Weekly review — new payor list',
    growthCopy:'Quick refresher on the Q4 additions.', issue:'Q4 payor additions — scheduled reading.',
    stage:'plan', createdDaysAgo:2, dueDaysAway:8 }),
  mkItem({ id:'co-208', agentId:'e7', assignedBy:'ai', source:'ai', competency:'discovery',
    title:'Confirm address before resupply orders',
    growthCopy:'Small habit that saves reship costs.', issue:'3 resupply orders to stale addresses in the last 30 days.',
    stage:'open', createdDaysAgo:5, dueDaysAway:2 }),
  mkItem({ id:'co-209', agentId:'e8', assignedBy:'manager', assignedByName:'Jordan Kim', source:'theme',
    competency:'empathy', title:'Warmer openers on CGM eligibility calls',
    growthCopy:'You\'re precise — add a little warmth.', issue:'Opening tone reads clinical on 4 of 7 CGM intakes.',
    stage:'open', createdDaysAgo:2, dueDaysAway:5 }),
  mkItem({ id:'co-210', agentId:'e2', assignedBy:'ai', source:'ai', competency:'compliance',
    title:'Payor disclosures — read the full script',
    growthCopy:'You\'re already compliant — let\'s polish the last line.', issue:'Truncated disclosure on 1 of 18 PA calls.',
    stage:'signed-off', createdDaysAgo:12, dueDaysAway:-3,
    practice:{ scenariosCompleted:2, targetScenarios:2, lastScore:9.4 },
    evidence:{ callId:'c184', note:'Full script delivered.', score:9.4 }, signedOff:true }),

  // team-wide bulk-assigned
  mkItem({ id:'co-301', agentId:'*team', assignedBy:'manager', assignedByName:'Jordan Kim', source:'theme',
    competency:'compliance', title:'Q4 compliance refresher (all agents)',
    growthCopy:'Ten minutes. Keeps us sharp.', issue:'Q4 regulatory updates — reading + 3 scenarios.',
    stage:'open', createdDaysAgo:1, dueDaysAway:14 }),
];

// Agent progress metrics
const AGENT_PROGRESS = {
  e1: { addressedThisMonth:5, activeItems:4, streak:6, lastSignOffDaysAgo:3, weeklyScore:[7.8, 8.1, 8.4, 8.6, 8.7, 8.9] },
  e2: { addressedThisMonth:7, activeItems:1, streak:14, lastSignOffDaysAgo:1, weeklyScore:[8.8,8.9,9.0,9.2,9.3,9.4] },
  e3: { addressedThisMonth:2, activeItems:3, streak:0,  lastSignOffDaysAgo:18, weeklyScore:[6.2,6.4,6.3,6.6,6.7,6.8] },
  e4: { addressedThisMonth:4, activeItems:2, streak:3,  lastSignOffDaysAgo:5, weeklyScore:[7.4,7.6,7.8,7.9,8.0,8.1] },
  e5: { addressedThisMonth:1, activeItems:4, streak:0,  lastSignOffDaysAgo:22, weeklyScore:[5.8,5.9,6.0,6.2,6.3,6.4] },
  e6: { addressedThisMonth:6, activeItems:1, streak:8,  lastSignOffDaysAgo:2, weeklyScore:[8.4,8.5,8.6,8.7,8.8,8.9] },
  e7: { addressedThisMonth:3, activeItems:2, streak:2,  lastSignOffDaysAgo:7, weeklyScore:[7.8,7.9,8.0,8.0,8.1,8.2] },
  e8: { addressedThisMonth:3, activeItems:2, streak:4,  lastSignOffDaysAgo:4, weeklyScore:[7.0,7.2,7.3,7.4,7.5,7.6] },
};

const STAGES = [
  { id:'open',       label:'Open',       desc:'Take a look when you\'re ready' },
  { id:'plan',       label:'Plan',       desc:'You\'ve picked your approach' },
  { id:'practice',   label:'Practice',   desc:'Rehearsing in simulator' },
  { id:'evidence',   label:'Evidence',   desc:'A live call showing change' },
  { id:'signed-off', label:'Signed off', desc:'Closed loop — nice work' },
];

Object.assign(window, { COMPETENCIES, COMPETENCY_SCORES, ITEMS, AGENT_PROGRESS, STAGES });
