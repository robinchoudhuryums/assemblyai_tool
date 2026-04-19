// Realistic calls list — 44 rows across 1 week.
// Deterministic sort: newest first by `at` timestamp.

const TEAMS = ['CPAP Intake', 'Prior Auth', 'CGM Eligibility', 'Oxygen', 'Resupply'];
const KINDS = ['CPAP', 'PA', 'CGM', 'O2', 'Resupply'];

const AGENTS = [
  { id:'e1', name:'Alex Rivera',    initials:'AR', team:'CPAP Intake' },
  { id:'e2', name:'Priya Shah',     initials:'PS', team:'Prior Auth' },
  { id:'e3', name:'Marcus Chen',    initials:'MC', team:'CGM Eligibility' },
  { id:'e4', name:'Dana Obi',       initials:'DO', team:'CPAP Intake' },
  { id:'e5', name:'Wren Halverson', initials:'WH', team:'Oxygen' },
  { id:'e6', name:'Sofia Ramos',    initials:'SR', team:'Prior Auth' },
  { id:'e7', name:'Jules Park',     initials:'JP', team:'Resupply' },
  { id:'e8', name:'Noah Bishop',    initials:'NB', team:'CGM Eligibility' },
];

const TOPICS_BANK = [
  'Order status, delayed auth',
  'Billing dispute — resolved',
  'Coverage question, elderly',
  'Eligibility — escalated',
  'Reorder supplies',
  'Status check',
  'Mask fit — return',
  'CPAP — first fill',
  'Prior auth — live payor call',
  'Oxygen setup consult',
  'CGM sensor malfunction',
  'Deductible question',
  'Resupply reminder',
  'Delivery complaint',
  'Coverage transfer',
  'Provider order missing',
  'Tubing replacement',
  'Humidifier warranty',
  'New Medicare enrollment',
  'Change of address',
];

const FLAG_MAP = {
  exceptional: { label:'Exemplar',        color:'var(--good)' },
  no_commit:   { label:'No follow-up',    color:'var(--warn)' },
  silence:     { label:'Long silence',    color:'var(--warn)' },
  hipaa:       { label:'HIPAA miss',      color:'var(--warn)' },
  escalated:   { label:'Escalated',       color:'var(--warn)' },
  review:      { label:'Needs review',    color:'var(--accent)' },
  coached:     { label:'Coached',         color:'var(--muted)' },
};

// Tiny seeded PRNG so the list is stable between renders
const seed = (s) => () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) / 4294967296); };
const rng = seed(19481210);

const mkCall = (id, daysAgo, hour, minute, agent, kind, topic, sentiment, score, durSec, flags=[], status='reviewed') => ({
  id, daysAgo, hour, minute, agent, kind, topic,
  sentiment, score, durSec,
  dur: `${Math.floor(durSec/60)}:${String(durSec%60).padStart(2,'0')}`,
  at: `${['Today','Yesterday','2d','3d','4d','5d','6d','1w'][daysAgo]} · ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,
  sortKey: daysAgo * 10000 + (23 - hour) * 100 + (60 - minute),
  flags, status,
});

const CALLS_RAW = [
  // Today
  mkCall('c201', 0, 11, 2, 'e1', 'CPAP', 'Order status, delayed auth', 'positive', 9.2, 522, ['exceptional'], 'reviewed'),
  mkCall('c200', 0, 10, 38, 'e2', 'PA',   'Billing dispute — resolved', 'positive', 9.6, 861, ['exceptional'], 'reviewed'),
  mkCall('c199', 0, 10, 21, 'e6', 'PA',   'Coverage question, elderly', 'neutral',  8.7, 552, [], 'reviewed'),
  mkCall('c198', 0, 9,  48, 'e3', 'CGM',  'Eligibility — escalated',    'negative', 5.3, 724, ['no_commit','escalated'], 'review'),
  mkCall('c197', 0, 9,  34, 'e1', 'CPAP', 'Reorder supplies',            'positive', 9.0, 242, [], 'reviewed'),
  mkCall('c196', 0, 9,  22, 'e4', 'CPAP', 'Status check',                'neutral',  5.8, 558, ['silence'], 'review'),
  mkCall('c195', 0, 8,  58, 'e5', 'O2',   'Oxygen setup consult',        'negative', 4.1, 462, ['hipaa'], 'review'),
  mkCall('c194', 0, 8,  40, 'e7', 'Resupply', 'Resupply reminder',       'positive', 8.4, 184, [], 'reviewed'),
  mkCall('c193', 0, 8,  12, 'e8', 'CGM',  'CGM sensor malfunction',      'neutral',  7.2, 395, [], 'reviewed'),
  // Yesterday
  mkCall('c192', 1, 16, 45, 'e2', 'PA',   'Deductible question',         'neutral',  8.1, 341, [], 'reviewed'),
  mkCall('c191', 1, 15, 22, 'e6', 'PA',   'Provider order missing',      'negative', 6.4, 612, ['review'], 'review'),
  mkCall('c190', 1, 14, 51, 'e1', 'CPAP', 'Mask fit — return',           'neutral',  7.9, 428, [], 'reviewed'),
  mkCall('c189', 1, 14, 18, 'e4', 'CPAP', 'CPAP — first fill',           'positive', 8.6, 512, [], 'reviewed'),
  mkCall('c188', 1, 13, 44, 'e3', 'CGM',  'Tubing replacement',          'positive', 8.8, 256, [], 'reviewed'),
  mkCall('c187', 1, 12, 30, 'e5', 'O2',   'Delivery complaint',          'negative', 4.8, 724, ['escalated'], 'review'),
  mkCall('c186', 1, 11, 12, 'e7', 'Resupply', 'Humidifier warranty',     'neutral',  7.5, 298, [], 'reviewed'),
  mkCall('c185', 1, 10, 8,  'e8', 'CGM',  'CGM sensor malfunction',      'neutral',  7.8, 342, [], 'reviewed'),
  mkCall('c184', 1, 9,  44, 'e2', 'PA',   'Prior auth — live payor call','positive', 9.4, 782, ['exceptional'], 'reviewed'),
  // 2d
  mkCall('c180', 2, 16, 22, 'e4', 'CPAP', 'Change of address',           'neutral',  7.2, 168, [], 'reviewed'),
  mkCall('c179', 2, 15, 40, 'e1', 'CPAP', 'Reorder supplies',            'positive', 9.1, 204, [], 'reviewed'),
  mkCall('c178', 2, 14, 12, 'e6', 'PA',   'Coverage transfer',           'neutral',  8.3, 512, [], 'reviewed'),
  mkCall('c177', 2, 13, 33, 'e5', 'O2',   'Oxygen setup consult',        'negative', 5.2, 608, ['hipaa','coached'], 'reviewed'),
  mkCall('c176', 2, 12, 4,  'e3', 'CGM',  'New Medicare enrollment',     'positive', 8.9, 478, [], 'reviewed'),
  mkCall('c175', 2, 11, 28, 'e8', 'CGM',  'Eligibility — escalated',     'negative', 5.6, 594, ['escalated'], 'reviewed'),
  mkCall('c174', 2, 10, 41, 'e7', 'Resupply', 'Resupply reminder',       'positive', 8.6, 212, [], 'reviewed'),
  // 3d
  mkCall('c170', 3, 15, 58, 'e2', 'PA',   'Billing dispute — resolved',  'positive', 9.3, 724, ['exceptional'], 'reviewed'),
  mkCall('c169', 3, 14, 24, 'e4', 'CPAP', 'Mask fit — return',           'neutral',  7.4, 332, [], 'reviewed'),
  mkCall('c168', 3, 13, 11, 'e1', 'CPAP', 'CPAP — first fill',           'positive', 8.8, 487, [], 'reviewed'),
  mkCall('c167', 3, 11, 42, 'e5', 'O2',   'Delivery complaint',          'neutral',  6.9, 412, [], 'reviewed'),
  mkCall('c166', 3, 10, 18, 'e3', 'CGM',  'CGM sensor malfunction',      'positive', 8.2, 301, [], 'reviewed'),
  // 4d
  mkCall('c160', 4, 16, 30, 'e6', 'PA',   'Prior auth — live payor call','positive', 9.5, 814, ['exceptional'], 'reviewed'),
  mkCall('c159', 4, 15, 2,  'e8', 'CGM',  'Deductible question',         'neutral',  7.6, 266, [], 'reviewed'),
  mkCall('c158', 4, 13, 48, 'e7', 'Resupply', 'Tubing replacement',      'positive', 8.9, 208, [], 'reviewed'),
  mkCall('c157', 4, 12, 22, 'e4', 'CPAP', 'Status check',                'neutral',  6.8, 488, [], 'reviewed'),
  mkCall('c156', 4, 10, 55, 'e1', 'CPAP', 'Order status, delayed auth',  'positive', 9.1, 468, [], 'reviewed'),
  // 5d
  mkCall('c150', 5, 15, 18, 'e2', 'PA',   'Coverage question, elderly',  'neutral',  8.2, 411, [], 'reviewed'),
  mkCall('c149', 5, 13, 44, 'e5', 'O2',   'Provider order missing',      'negative', 5.9, 612, ['review','coached'], 'reviewed'),
  mkCall('c148', 5, 11, 8,  'e3', 'CGM',  'Humidifier warranty',         'neutral',  7.3, 284, [], 'reviewed'),
  mkCall('c147', 5, 10, 12, 'e2', 'PA',   'Prior auth — live payor call','positive', 9.6, 664, ['exceptional'], 'reviewed'),
  // 6d
  mkCall('c140', 6, 14, 25, 'e4', 'CPAP', 'Reorder supplies',            'positive', 8.5, 228, [], 'reviewed'),
  mkCall('c139', 6, 12, 40, 'e8', 'CGM',  'CGM sensor malfunction',      'neutral',  7.7, 318, [], 'reviewed'),
  mkCall('c138', 6, 10, 18, 'e7', 'Resupply', 'Resupply reminder',       'positive', 8.3, 196, [], 'reviewed'),
  // 1w
  mkCall('c130', 7, 15, 40, 'e6', 'PA',   'Coverage transfer',           'neutral',  7.9, 398, [], 'reviewed'),
  mkCall('c129', 7, 11, 24, 'e1', 'CPAP', 'CPAP — first fill',           'positive', 8.8, 452, [], 'reviewed'),
  mkCall('c128', 7, 10, 2,  'e5', 'O2',   'Oxygen setup consult',        'negative', 6.1, 522, ['coached'], 'reviewed'),
];

// Hydrate with agent objects for convenience
const CALLS = CALLS_RAW.map(c => ({
  ...c,
  agentObj: AGENTS.find(a => a.id === c.agent),
})).sort((a,b) => a.sortKey - b.sortKey);

// Saved views
const SAVED_VIEWS = [
  { id:'all',          name:'All calls',            filter:{} },
  { id:'needs_review', name:'Needs review',         filter:{status:'review'} },
  { id:'low_score',    name:'Low score (< 7)',      filter:{maxScore:6.99} },
  { id:'exemplars',    name:'Exemplars',            filter:{flag:'exceptional'} },
  { id:'negative',     name:'Negative sentiment',   filter:{sentiment:'negative'} },
  { id:'cpap',         name:'CPAP team',            filter:{team:'CPAP Intake'} },
];

// Rollup for summary bar
const summary = (rows) => {
  const n = rows.length;
  const avg = n ? rows.reduce((s,r)=>s+r.score,0)/n : 0;
  const pos = rows.filter(r => r.sentiment === 'positive').length;
  const neg = rows.filter(r => r.sentiment === 'negative').length;
  const flagged = rows.filter(r => r.flags.length > 0).length;
  const needsReview = rows.filter(r => r.status === 'review').length;
  const exemplars = rows.filter(r => r.flags.includes('exceptional')).length;
  const totalMin = Math.round(rows.reduce((s,r)=>s+r.durSec,0) / 60);
  return { n, avg, pos, neg, flagged, needsReview, exemplars, totalMin };
};

Object.assign(window, { AGENTS, CALLS, SAVED_VIEWS, FLAG_MAP, summary });
