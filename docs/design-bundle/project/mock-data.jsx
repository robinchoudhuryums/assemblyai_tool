// Mock healthcare DME call data. Inspired by the seed presets (CPAP/CGM/Oxygen).

const TEAM = [
  { id: 'e1', name: 'Alex Rivera',     initials: 'AR', team: 'CPAP Intake',    score: 9.2, trend: +0.4, calls: 142 },
  { id: 'e2', name: 'Priya Shah',      initials: 'PS', team: 'Prior Auth',     score: 8.7, trend: +0.1, calls: 118 },
  { id: 'e3', name: 'Marcus Chen',     initials: 'MC', team: 'CGM Eligibility',score: 8.1, trend: -0.3, calls: 97  },
  { id: 'e4', name: 'Dana Obi',        initials: 'DO', team: 'CPAP Intake',    score: 7.4, trend: +0.6, calls: 84  },
  { id: 'e5', name: 'Wren Halverson',  initials: 'WH', team: 'Oxygen',         score: 6.3, trend: -0.8, calls: 71  },
  { id: 'e6', name: 'Sofia Ramos',     initials: 'SR', team: 'Prior Auth',     score: 8.4, trend: +0.2, calls: 110 },
];

const FLAGGED = [
  { id: 'c101', who: 'Wren Halverson', team: 'Oxygen',  reason: 'Missed HIPAA verification',    score: 4.1, dur: '7:42', time: '10:12' },
  { id: 'c088', who: 'Marcus Chen',    team: 'CGM',     reason: 'Escalated — no follow-up commit', score: 5.3, dur: '12:04', time: '09:48' },
  { id: 'c077', who: 'Dana Obi',       team: 'CPAP',    reason: 'Long silence > 22s',            score: 5.8, dur: '9:18', time: '09:22' },
];

const EXCEPTIONAL = [
  { id: 'c092', who: 'Alex Rivera',   team: 'CPAP',  reason: 'Proactive auth call on hold',  score: 9.8, dur: '6:40', time: '11:02' },
  { id: 'c094', who: 'Priya Shah',    team: 'PA',    reason: 'De-escalated billing dispute', score: 9.6, dur: '14:21', time: '10:38' },
];

// 24-hour sentiment curve. Each point = avg sentiment across calls that hour.
// Range [-1..+1]. null = no calls.
const SENTIMENT_CURVE = [
  null, null, null, null, null, null, // 00-05
  null, 0.1, 0.35, 0.52, 0.48, 0.61,   // 06-11
  0.55, 0.28, -0.12, -0.34, -0.18, 0.12, // 12-17
  0.44, 0.58, 0.41, 0.2, null, null    // 18-23
];

// Call volume per hour
const VOLUME = [
  0,0,0,0,0,0, 0,4,18,32,41,38, 44,29,22,36,31,19, 12,8,5,2,0,0
];

// Rubric breakdown (0-10)
const RUBRIC = {
  compliance: 9.1,
  customerExperience: 8.4,
  communication: 8.9,
  resolution: 7.8,
};

// Recent call snippets — becomes the "front-page" ledger
const RECENT_CALLS = [
  { id:'c201', who:'Alex Rivera', ext:'x4412', kind:'CPAP', topic:'Order status, delayed auth', sentiment:'positive', score:9.8, dur:'6:40', at:'11:02', flags:['exceptional'] },
  { id:'c200', who:'Priya Shah',  ext:'x4418', kind:'PA',   topic:'Billing dispute — resolved',  sentiment:'positive', score:9.6, dur:'14:21', at:'10:38', flags:['exceptional'] },
  { id:'c199', who:'Sofia Ramos', ext:'x4420', kind:'PA',   topic:'Coverage question, elderly',  sentiment:'neutral',  score:8.7, dur:'9:12', at:'10:21', flags:[] },
  { id:'c198', who:'Marcus Chen', ext:'x4402', kind:'CGM',  topic:'Eligibility — escalated',     sentiment:'negative', score:5.3, dur:'12:04', at:'09:48', flags:['no_commit'] },
  { id:'c197', who:'Alex Rivera', ext:'x4412', kind:'CPAP', topic:'Reorder supplies',            sentiment:'positive', score:9.0, dur:'4:02', at:'09:34', flags:[] },
  { id:'c196', who:'Dana Obi',    ext:'x4407', kind:'CPAP', topic:'Status check',                sentiment:'neutral',  score:5.8, dur:'9:18', at:'09:22', flags:['silence'] },
];

// AI summary for the day
const DAY_SUMMARY = `Volume up 12% driven by CPAP intake. Two Oxygen calls missed HIPAA verification — both Wren H. Billing-dispute de-escalations by Priya S. are a pattern worth sharing in coaching.`;

// A transcript snippet (for the inline coaching highlight demo)
const TRANSCRIPT = [
  { t:'0:02', sp:'agent', name:'Alex', text:'Thank you for calling UMS, my name is Alex. How can I help you today?' },
  { t:'0:07', sp:'cust',  name:'Patient', text:'Hi, I\'m calling about my CPAP order. It\'s been three weeks and I haven\'t heard anything.' },
  { t:'0:18', sp:'agent', name:'Alex', text:'I\'m sorry to hear it\'s been delayed. Let me pull up your account right now. Can you verify your date of birth?', coach:{ kind:'good', label:'Empathy + verification', note:'Acknowledges frustration before requesting PHI.' } },
  { t:'0:29', sp:'cust',  name:'Patient', text:'Yes, it\'s March 14, 1958.' },
  { t:'0:34', sp:'agent', name:'Alex', text:'Thank you. I can see your order — we\'re waiting on the prior authorization from your insurance. I\'ll call them right now while you\'re on the line.', coach:{ kind:'good', label:'Proactive ownership', note:'Commits to action instead of deferring.' } },
  { t:'0:52', sp:'agent', name:'Alex', text:'Do you mind if I put you on a brief hold?' },
  { t:'1:04', sp:'hold',  name:'',     text:'— hold · 0:08 —' },
  { t:'1:12', sp:'agent', name:'Alex', text:'Thanks for holding. Good news — the authorization is approved. Your CPAP will ship tomorrow and you should have it within three to five business days.' },
  { t:'1:29', sp:'agent', name:'Alex', text:'I\'ll send you a tracking email today.', coach:{ kind:'missed', label:'Confirm callback number', note:'Rubric expects verbal callback confirmation before close.' } },
  { t:'1:35', sp:'cust',  name:'Patient', text:'Oh wonderful, thank you so much for looking into this right away.' },
];

Object.assign(window, { TEAM, FLAGGED, EXCEPTIONAL, SENTIMENT_CURVE, VOLUME, RUBRIC, RECENT_CALLS, DAY_SUMMARY, TRANSCRIPT });
