// Extended mock transcript data for a single call — "c201"
// Real-world-ish DME (Durable Medical Equipment) support call. 8:42 duration.
// Sentiment is per-segment (-1..+1). Speakers: agent, cust, hold, sys.

const CALL_META = {
  id: 'c201',
  subject: 'CPAP order — delayed prior authorization',
  agent: { name: 'Alex Rivera', initials: 'AR', team: 'CPAP Intake', ext: 'x4412' },
  customer: { name: 'Harold W.', id: 'P-48821', account: 'Medicare · Plan F' },
  channel: 'Inbound · toll-free',
  startedAt: 'Wed · 11:02 AM',
  duration: '8:42',
  durationSec: 522,
  score: 9.2,
  sentiment: 'positive',
  tags: ['CPAP', 'Prior Auth', 'Callback pending'],
  rubric: {
    compliance: 9.1,
    customerExperience: 9.4,
    communication: 9.0,
    resolution: 8.8,
  },
};

// Segment = [startSec, endSec, speaker, text, sentiment, coach?]
// coach = { kind: 'good' | 'missed' | 'watch', label, note }
const SEGMENTS = [
  [2,   7,   'agent', 'Thank you for calling UMS Medical Supply, my name is Alex. How can I help you today?', 0.1],
  [8,   19,  'cust',  "Hi Alex, I'm calling about my CPAP order. It's been almost three weeks and I haven't heard a single thing.", -0.45],
  [20,  22,  'cust',  "I'm honestly getting pretty frustrated.", -0.62],
  [23,  34,  'agent', "I completely understand — three weeks is far too long to be waiting, and I'm sorry it's been this way. Let me pull up your account right now. Can I start with your date of birth to verify?", 0.35,
    { kind:'good', label:'Empathy before PHI', note:'Acknowledges frustration before requesting protected info — rubric item 2.3.' }],
  [35,  40,  'cust',  "Sure, it's March 14th, 1958.", 0.1],
  [41,  44,  'agent', "Thank you, Harold. And the last four of your Medicare ID?", 0.2],
  [45,  48,  'cust',  "Two, one, eight, seven.", 0.1],
  [49,  68,  'agent', "Perfect, you're verified. Okay — I can see your CPAP order was placed on the 3rd, and it's been sitting waiting on a prior authorization from Medicare. That's what the holdup is. I'm going to call them right now while you're on the line and see if we can push this through today.", 0.55,
    { kind:'good', label:'Proactive ownership', note:'Commits to action instead of deferring to callback or ticket.' }],
  [69,  75,  'cust',  "Oh — you can do that right now? I've been calling for days and everyone just tells me to wait.", 0.35],
  [76,  83,  'agent', "Yes sir. I'll put you on a brief hold — no more than a couple minutes — and I'll come right back to you with an update. Is that alright?", 0.5],
  [84,  86,  'cust',  "Yes, please, go ahead.", 0.3],
  [87,  174, 'hold',  '— on hold · 1:27 —', null],
  [175, 192, 'agent', "Harold, thank you so much for holding. I've got good news — I just got off the phone with Medicare and your prior authorization has been approved. The order is moving now. You should see it ship within 24 hours.", 0.75],
  [193, 198, 'cust',  "Oh my goodness, thank you. Really, thank you.", 0.85],
  [199, 214, 'agent', "You're very welcome. Let me set expectations on delivery — it'll go out on FedEx Ground, which is typically three to five business days to your area. I'll send you the tracking number by email today as soon as it's generated.", 0.55],
  [215, 222, 'cust',  "That would be great. Same email you have on file? The Gmail one?", 0.25],
  [223, 232, 'agent', "Yes, harold.w at gmail dot com — that's the one I've got. I'll also include the patient instruction sheet and the quick-start guide as PDFs so you have everything you need before it arrives.", 0.4,
    { kind:'watch', label:'Nice proactive add-on', note:'Going beyond the ask without making the call longer.' }],
  [233, 241, 'cust',  "That's wonderful. My wife was asking about how to clean the mask, so that'll help.", 0.45],
  [242, 260, 'agent', "Absolutely — there's a great two-page section on that in the guide. If you or your wife have questions once it arrives, just call us back at this same number and we'll walk you through it. We have a respiratory therapist on staff who does setup consults.", 0.5],
  [261, 267, 'cust',  "Oh that's nice to know. Is there a charge for that?", 0.05],
  [268, 283, 'agent', "Nope — it's included in your supply benefit, no out of pocket for you. Just call and ask for the setup consult and we'll get you scheduled usually within two business days.", 0.5],
  [284, 290, 'cust',  "Okay. Thank you Alex, you've been so helpful.", 0.7],
  [291, 310, 'agent', "My pleasure, Harold. Before we wrap up — is there anything else you need me to look into today?", 0.3,
    { kind:'missed', label:'Confirm callback number', note:'Rubric item 4.1 — verbal callback confirmation expected before close. A quick "and the best number to reach you is still 555-0147?" closes the loop.' }],
  [311, 314, 'cust',  "No, I think that's everything.", 0.2],
  [315, 336, 'agent', "Perfect. Just to recap — your CPAP prior auth was approved just now, your order will ship within 24 hours, tracking will hit your email today, and the setup consult with the RT is available whenever you're ready after it arrives. Anything else I can do for you?", 0.4,
    { kind:'good', label:'Clean recap', note:'Structured close with all commitments enumerated.' }],
  [337, 341, 'cust',  "No that's it. Thank you so much.", 0.65],
  [342, 351, 'agent', "You're very welcome, Harold. Thank you for choosing UMS. You have a great rest of your day.", 0.5],
  [352, 354, 'cust',  "You too. Bye now.", 0.5],
];

// Decoded per-second sentiment series (interpolated between segment midpoints) — used for scrubber curve.
const SENTIMENT_SERIES = (() => {
  const out = new Array(CALL_META.durationSec).fill(0);
  const pts = SEGMENTS.filter(s => s[4] != null).map(s => [(s[0]+s[1])/2, s[4]]);
  // linear interp between control points
  for (let i=0; i<out.length; i++) {
    // find surrounding points
    let before = pts[0], after = pts[pts.length-1];
    for (let j=0; j<pts.length-1; j++) {
      if (pts[j][0] <= i && pts[j+1][0] >= i) { before = pts[j]; after = pts[j+1]; break; }
    }
    if (before[0] === after[0]) out[i] = before[1];
    else {
      const t = (i - before[0]) / (after[0] - before[0]);
      out[i] = before[1] + (after[1] - before[1]) * Math.max(0, Math.min(1, t));
    }
  }
  return out;
})();

// Waveform amplitude data (synthetic but seed-consistent)
const WAVEFORM = (() => {
  const bars = 180; // one bar ~= 3 seconds
  const out = [];
  for (let i=0; i<bars; i++) {
    const secStart = (i / bars) * CALL_META.durationSec;
    // Silence during hold
    const inHold = secStart >= 87 && secStart <= 174;
    // base
    let a = 0.25 + Math.abs(Math.sin(i * 0.9)) * 0.3 + Math.abs(Math.sin(i * 0.37)) * 0.25;
    // speaking bumps
    a += Math.random() * 0.35;
    if (inHold) a = 0.04 + Math.random() * 0.02;
    out.push(Math.min(1, a));
  }
  return out;
})();

// Chapters for fast nav — auto-generated from transcript
const CHAPTERS = [
  { t: 0,   title: 'Greeting & verification',    kind:'open' },
  { t: 49,  title: 'Issue triage',               kind:'work' },
  { t: 87,  title: 'On hold — calling Medicare', kind:'hold' },
  { t: 175, title: 'Resolution delivered',       kind:'win' },
  { t: 242, title: 'Setup consult & add-ons',    kind:'work' },
  { t: 291, title: 'Close',                      kind:'close' },
];

// Action items & commitments extracted
const ACTIONS = [
  { who:'agent',  text:'Send tracking email with patient instruction sheet + quick-start PDFs',  by:'Today', status:'pending' },
  { who:'agent',  text:'Ship CPAP order within 24h (auth approved on call)',                      by:'Tomorrow', status:'committed' },
  { who:'patient', text:'Call back to schedule RT setup consult after delivery',                   by:'After delivery', status:'optional' },
];

// Topics extracted (for Manager view)
const TOPICS = [
  { name:'Prior authorization', weight: 0.38 },
  { name:'CPAP delivery',       weight: 0.22 },
  { name:'Setup consult',       weight: 0.18 },
  { name:'Cleaning & care',     weight: 0.12 },
  { name:'Medicare benefits',   weight: 0.10 },
];

// AI summary, two flavors
const SUMMARY_AGENT = `Strong call, Alex. You handled an angry patient with empathy, took ownership by calling Medicare live, and delivered a real resolution in under 9 minutes. One small miss: you never verbally confirmed the callback number before closing — rubric item 4.1. Everything else was textbook.`;
const SUMMARY_MANAGER = `Exemplar call — Alex turned a 3-week escalation into a same-call resolution by calling Medicare live (1:27 hold). Empathy + proactive ownership are both strong. Compliance hit on PHI verification sequence. One rubric miss: no verbal callback confirmation at close (4.1). Safe to use as a coaching exemplar for the CPAP Intake team.`;

// Similar calls (for Manager view only)
const SIMILAR_CALLS = [
  { id:'c147', who:'Priya Shah',  topic:'Prior auth — live payor call', score:9.6, dur:'11:04', when:'2d ago' },
  { id:'c093', who:'Alex Rivera', topic:'CPAP delay — empathy-led',     score:9.4, dur:'7:12',  when:'5d ago' },
  { id:'c061', who:'Sofia Ramos', topic:'Medicare escalation, resolved',score:9.1, dur:'13:22', when:'1w ago' },
];

Object.assign(window, {
  CALL_META, SEGMENTS, SENTIMENT_SERIES, WAVEFORM, CHAPTERS,
  ACTIONS, TOPICS, SUMMARY_AGENT, SUMMARY_MANAGER, SIMILAR_CALLS
});
