// Simulator: scenarios (rich personas), branching scripts, rubric moments.

const SCENARIO_DIFFICULTY = [
  { id:'warmup', label:'Warm-up', color:'var(--good)' },
  { id:'stretch', label:'Stretch', color:'var(--accent)' },
  { id:'boss',    label:'Boss',    color:'var(--warn)' },
];

const COMPETENCIES = [
  { id:'empathy',    label:'Empathy' },
  { id:'compliance', label:'Compliance' },
  { id:'discovery',  label:'Discovery' },
  { id:'product',    label:'Product' },
  { id:'close',      label:'Close & next steps' },
  { id:'pace',       label:'Pace & pauses' },
];

// Rich personas
const PERSONAS = {
  margaret: {
    id:'margaret', name:'Margaret Ellison', age:74, avatar:'ME',
    voice:'slow, careful, often asks for repeats',
    attitude:'anxious but polite',
    backstory:'Recently diagnosed with sleep apnea. Husband passed 8 months ago. Lives alone. First time using any CPAP equipment. Daughter in another state nudged her to start treatment.',
    insurance:'Medicare Part B + supplemental',
    hiddenObjections:[
      'Embarrassed about the mask, doesn\'t want to admit it',
      'Worries about cost even after insurance',
      'Scared the machine will be loud — husband was a snorer',
    ],
    mood:{ start:0.2, volatility:0.15 }, // 0..1 positivity, 0 = very down
    quirks:['Writes everything down', 'Says "dear" often', 'Will apologize for "wasting your time"']
  },
  rashad: {
    id:'rashad', name:'Rashad Patel', age:42, avatar:'RP',
    voice:'direct, fast, slightly impatient',
    attitude:'frustrated — third call about this',
    backstory:'Diabetic, G7 CGM sensor. His third call this week about a billing error. Works in IT, has no patience for scripts or hold music.',
    insurance:'Aetna PPO',
    hiddenObjections:[
      'Will escalate if read a disclosure verbatim again',
      'Wants specific numbers and timelines, not platitudes',
      'Will test compliance: asks leading questions hoping for rule-breaks',
    ],
    mood:{ start:-0.4, volatility:0.3 },
    quirks:['Uses technical language', 'Interrupts apologies', 'Asks for names and reference numbers']
  },
  denise: {
    id:'denise', name:'Denise Marceau', age:58, avatar:'DM',
    voice:'warm, chatty, goes on tangents',
    attitude:'friendly, overshares',
    backstory:'Oxygen therapy setup after a hospitalization. Extremely chatty — will tell you about grandkids, her cat, weather. Needs a gentle hand to stay on task.',
    insurance:'BCBS Federal',
    hiddenObjections:[
      'Will feel rushed if redirected too sharply',
      'Needs to feel heard before moving on',
      'Hides confusion behind cheerfulness',
    ],
    mood:{ start:0.6, volatility:0.2 },
    quirks:['Asks about your day', 'Talks about her cat "Peanut"', 'Says "bless your heart"']
  },
  kenji: {
    id:'kenji', name:'Kenji Watanabe', age:29, avatar:'KW',
    voice:'quiet, clipped, one-word answers',
    attitude:'reserved, maybe embarrassed',
    backstory:'CPAP intake. Clearly uncomfortable on the phone. Answers yes/no. Needs patience and space. If rushed, will disengage.',
    insurance:'United HMO',
    hiddenObjections:[
      'Won\'t ask follow-ups even when confused',
      'Will agree to things he doesn\'t understand',
      'Needs silence to be OK',
    ],
    mood:{ start:0, volatility:0.1 },
    quirks:['Long pauses before answering', 'Says "uh" and "okay"', 'Background: young kids']
  },
};

// Branching script / choose-your-response
// Each beat: patient line, then 3-4 responses. Some 'exemplar,' some 'miss,' some 'neutral.'
const SCENARIOS = [
  {
    id:'s-margaret-first-cpap',
    persona:'margaret',
    title:'Margaret — first-time CPAP intake',
    summary:'74-year-old widow, anxious, brand new to CPAP. Tests your patience and acknowledgment-first instincts.',
    competency:'empathy',
    difficulty:'warmup',
    duration:'~8 min',
    assigned:true,
    assignedBy:'Jordan Kim',
    coachingLink:'co-101',
    rubricFocus:['empathy','pace'],
    beats:[
      {
        t:'00:12', who:'patient',
        line:'Hello? I... I think my doctor called about a breathing machine? I\'m not really sure what to do with all this.',
        mood:0.1,
      },
      {
        t:'00:28', who:'agent',
        prompt:'How do you open?',
        options:[
          { id:'a', text:'Hi Margaret, thanks for calling. I\'m going to help you get set up today — we\'ll take it one step at a time, no rush.', score:'exemplar', rubricHit:['empathy'] },
          { id:'b', text:'Hi, I have your referral here. Let me verify your date of birth first.', score:'miss', rubricMiss:['empathy'], note:'Verification is important but can come after a warm opener.' },
          { id:'c', text:'Hi Margaret! So we\'re going to get you fitted for a CPAP today. Do you have any questions about it?', score:'neutral', note:'Friendly, but a vague question may overwhelm an anxious patient.' },
        ],
      },
      {
        t:'00:52', who:'patient',
        line:'Oh, thank you. I\'m sorry, I\'m just not good with all this tech. My husband always handled things like this.',
        mood:0.25,
      },
      {
        t:'01:10', who:'agent',
        prompt:'She\'s opened up. Respond.',
        options:[
          { id:'a', text:'That\'s completely okay — I\'ll walk you through everything. We\'ll go slow.', score:'exemplar', rubricHit:['empathy','pace'] },
          { id:'b', text:'No problem. Can you confirm your date of birth for me?', score:'miss', rubricMiss:['empathy'], note:'She just shared something vulnerable. Acknowledge before moving on.' },
          { id:'c', text:'Don\'t worry, it\'s easier than it sounds.', score:'neutral', note:'Reassuring but dismissive of her feeling.' },
        ],
      },
      {
        t:'01:40', who:'patient',
        line:'Okay... before we go any further... how much is this going to cost me? I\'m on a fixed income.',
        mood:0,
      },
      {
        t:'01:58', who:'agent',
        prompt:'Money worry surfaces.',
        options:[
          { id:'a', text:'Good question. Let me pull up your coverage — most of this is covered by Medicare, but I want to give you a clear picture, not a guess.', score:'exemplar', rubricHit:['empathy','discovery'] },
          { id:'b', text:'It\'s mostly covered, don\'t worry.', score:'miss', rubricMiss:['product','compliance'], note:'Never promise coverage without verifying.' },
          { id:'c', text:'I\'ll get to that — first let me verify your info.', score:'neutral', note:'Defers her concern. Acknowledge first.' },
        ],
      },
      {
        t:'02:30', who:'patient',
        line:'(quieter) Alright. Thank you for explaining. I just... don\'t want to be a burden.',
        mood:0.4,
      },
      {
        t:'02:50', who:'agent',
        prompt:'Key moment. What do you say?',
        options:[
          { id:'a', text:'Margaret, you\'re not a burden — this is what I\'m here for. Take all the time you need.', score:'exemplar', rubricHit:['empathy'] },
          { id:'b', text:'Okay, moving on — next I need your insurance card.', score:'miss', rubricMiss:['empathy'], note:'Missed the emotional moment entirely.' },
          { id:'c', text:'You\'re no trouble at all. Ready to continue?', score:'neutral', note:'Okay, but thin — she needed a bigger acknowledgment.' },
        ],
      },
    ],
  },
  {
    id:'s-rashad-billing',
    persona:'rashad', title:'Rashad — billing dispute, third call',
    summary:'Frustrated diabetic patient on his third call about a billing error. Tests compliance + composure.',
    competency:'compliance', difficulty:'boss', duration:'~10 min',
    assigned:true, assignedBy:'AI detection',
    rubricFocus:['compliance','empathy','close'],
    beats:[
      { t:'00:08', who:'patient', line:'This is the third time I\'ve called about this. I better not get a script read at me again. Just tell me why I was charged $340 for a sensor that\'s supposed to be covered.', mood:-0.5 },
      { t:'00:24', who:'agent', prompt:'High-heat opener.',
        options:[
          { id:'a', text:'You\'re right to be frustrated — three calls is too many. I\'m going to pull up your account and get you a real answer today.', score:'exemplar', rubricHit:['empathy','close'] },
          { id:'b', text:'I understand. Can I get your date of birth to verify?', score:'neutral', note:'Compliant, but formulaic given his frustration.' },
          { id:'c', text:'Sir, I need to read a brief disclosure before we continue.', score:'miss', rubricMiss:['empathy'], note:'Technically correct, emotionally wrong for this moment.' },
        ] },
    ],
  },
  {
    id:'s-denise-oxygen',
    persona:'denise', title:'Denise — oxygen setup, chatty',
    summary:'Overshares and goes on tangents. Tests pacing and gentle redirection without making her feel rushed.',
    competency:'pace', difficulty:'stretch', duration:'~7 min',
    assigned:false, rubricFocus:['pace','empathy','discovery'],
    beats:[{ t:'00:10', who:'patient', line:'Oh hi sweetie! Before we start — did you see the weather today? My cat Peanut was just sitting by the window watching the rain, and I swear she was telling me something...', mood:0.7 }]
  },
  {
    id:'s-kenji-quiet',
    persona:'kenji', title:'Kenji — quiet CPAP intake',
    summary:'Reserved patient, one-word answers. Tests patience and creating space without assumptions.',
    competency:'discovery', difficulty:'stretch', duration:'~6 min',
    assigned:false, rubricFocus:['discovery','pace'],
    beats:[{ t:'00:10', who:'patient', line:'Yeah. Hi.', mood:0 }]
  },
  {
    id:'s-rashad-hipaa',
    persona:'rashad', title:'Rashad — HIPAA pressure test',
    summary:'Patient tries to get info released to a family member without consent. Tests firm-but-kind compliance.',
    competency:'compliance', difficulty:'boss', duration:'~5 min',
    assigned:false, rubricFocus:['compliance'],
    beats:[{ t:'00:08', who:'patient', line:'Hey, can you just email the details to my wife? She handles all this. Her email is...', mood:-0.2 }]
  },
  {
    id:'s-margaret-return',
    persona:'margaret', title:'Margaret — mask return',
    summary:'She wants to return her mask but is embarrassed to say why. Tests gentle discovery.',
    competency:'discovery', difficulty:'warmup', duration:'~5 min',
    assigned:false, rubricFocus:['discovery','empathy'],
    beats:[{ t:'00:10', who:'patient', line:'I was hoping to... return the mask. It\'s not working out. I\'d rather not go into it, if that\'s okay.', mood:-0.1 }]
  },
  {
    id:'s-denise-eligibility',
    persona:'denise', title:'Denise — coverage transfer',
    summary:'New insurance mid-therapy. Complex case with compliant disclosures.',
    competency:'product', difficulty:'stretch', duration:'~9 min',
    assigned:false, rubricFocus:['product','compliance'],
    beats:[{ t:'00:10', who:'patient', line:'Hi honey, so I just got on my husband\'s new plan and I need to figure out how that works with my oxygen...', mood:0.5 }]
  },
];

// Post-session result — example (for Margaret scenario)
const SAMPLE_RESULT = {
  scenarioId:'s-margaret-first-cpap',
  completedAt:'Today · 14:22',
  durationSec:478,
  rubric:{
    empathy:9.2,
    compliance:8.0,
    discovery:7.4,
    product:8.1,
    close:7.8,
    pace:8.7,
    overall:8.2,
  },
  moments:[
    { t:'00:28', kind:'win', label:'Warm opener', note:'You invited her to take her time — exactly what an anxious patient needs.' },
    { t:'01:10', kind:'win', label:'Acknowledged vulnerability', note:'"That\'s completely okay — we\'ll go slow." Textbook acknowledgment.' },
    { t:'01:58', kind:'neutral', label:'Cost question', note:'Good instinct to not promise coverage. Consider also acknowledging it\'s a fair worry.' },
    { t:'02:50', kind:'win', label:'Held the moment', note:'You caught "I don\'t want to be a burden" and met it. Sentiment jumped +0.4.' },
    { t:'03:40', kind:'miss', label:'Rushed verification', note:'After the emotional beat, you moved to DOB quickly. Breath first next time.' },
  ],
  compareExemplar:{
    yourScore:8.2, exemplarScore:9.1,
    gap:'Slightly faster pace than exemplar. Exemplar averaged 2.1s pause after patient spoke; you averaged 0.9s.',
  },
  coachingUpdate:{
    itemId:'co-101', newStage:'evidence',
    message:'This session counts as evidence of change on "Slow down on intake questions." One more rep to sign off.',
  },
  nextSuggested:{ id:'s-margaret-return', title:'Margaret — mask return', reason:'Builds on empathy with a different context.' },
};

// Agent streaks etc for stage/profile
const SIM_PROGRESS = {
  e1: { sessionsThisWeek:4, totalSessions:23, streak:3, avgScore:7.9, topCompetency:'empathy', weeklyAvg:[6.8, 7.2, 7.4, 7.7, 7.9, 8.2] },
};

Object.assign(window, { SCENARIO_DIFFICULTY, COMPETENCIES, PERSONAS, SCENARIOS, SAMPLE_RESULT, SIM_PROGRESS });
