// Data for admin-only Simulated Call Generator.
// Matches shape of reference/simulated-calls.tsx — synthetic calls, voices, circumstances.

const CIRCUMSTANCE_META = {
  angry:          { label:'Angry customer',       description:'Elevated tone, interruptions, possible escalation', ruleBased:true },
  hard_of_hearing:{ label:'Hard of hearing',      description:'Pardons, repeats, louder agent tone',              ruleBased:true },
  escalation:     { label:'Supervisor escalation',description:'Customer demands supervisor, handoff mid-call',     ruleBased:true },
  billing_dispute:{ label:'Billing dispute',      description:'Invoice amount, coverage gap, or duplicate charge', ruleBased:false },
  equipment_fault:{ label:'Equipment fault',      description:'Device not working as expected, troubleshooting',  ruleBased:false },
  pharmacy_conf:  { label:'Pharmacy confusion',   description:'Mix-up between DME and pharmacy dispensing',       ruleBased:false },
  new_diagnosis:  { label:'New diagnosis',        description:'First-time patient, emotional, lots of questions', ruleBased:false },
  insurance_lapse:{ label:'Insurance lapse',      description:'Coverage ended mid-therapy, PA needed',           ruleBased:false },
};
const CIRCUMSTANCE_VALUES = Object.keys(CIRCUMSTANCE_META);

// Generated calls — Library fixtures
const SIMULATED_CALLS = [
  {
    id:'sc-001', title:'CPAP status check (Margaret baseline)',
    scenario:'Anxious new user, first CPAP. Warm opener, gentle discovery.',
    qualityTier:'excellent', status:'ready',
    durationSeconds:184, ttsCharCount:2140, estimatedCost:0.6420,
    createdAt:'2026-04-18T13:42:00Z',
    config:{ circumstances:['new_diagnosis'] },
    sentToAnalysisCallId:'call-9814',
    turns:14,
  },
  {
    id:'sc-002', title:'Rashad — billing dispute (angry)',
    scenario:'Third call about same bill. Customer loses patience at 1:30.',
    qualityTier:'acceptable', status:'ready',
    durationSeconds:246, ttsCharCount:2810, estimatedCost:0.8430,
    createdAt:'2026-04-18T12:15:00Z',
    config:{ circumstances:['angry','billing_dispute'] },
    sentToAnalysisCallId:null, turns:18,
  },
  {
    id:'sc-003', title:'Denise — coverage transfer',
    scenario:'New insurance mid-therapy. Chatty, tangential. Needs gentle redirect.',
    qualityTier:'acceptable', status:'ready',
    durationSeconds:312, ttsCharCount:3620, estimatedCost:1.0860,
    createdAt:'2026-04-18T11:03:00Z',
    config:{ circumstances:['insurance_lapse'] },
    sentToAnalysisCallId:null, turns:22,
  },
  {
    id:'sc-004', title:'Escalation drill — supervisor handoff',
    scenario:'Customer demands supervisor at turn 8. Agent must de-escalate or escalate properly.',
    qualityTier:'poor', status:'ready',
    durationSeconds:208, ttsCharCount:2420, estimatedCost:0.7260,
    createdAt:'2026-04-18T09:48:00Z',
    config:{ circumstances:['escalation','angry'] },
    sentToAnalysisCallId:'call-9802', turns:16,
  },
  {
    id:'sc-005', title:'Hard-of-hearing — G7 setup',
    scenario:'Senior patient, frequent pardons. Tests agent\'s pacing and enunciation.',
    qualityTier:'acceptable', status:'generating',
    durationSeconds:null, ttsCharCount:2980, estimatedCost:null,
    createdAt:'2026-04-18T14:20:00Z',
    config:{ circumstances:['hard_of_hearing'] }, turns:15,
  },
  {
    id:'sc-006', title:'Pharmacy confusion variation',
    scenario:'Customer called DME expecting pharmacy. Ops handoff + warm transfer.',
    qualityTier:'acceptable', status:'pending',
    durationSeconds:null, ttsCharCount:2240, estimatedCost:null,
    createdAt:'2026-04-18T14:25:00Z',
    config:{ circumstances:['pharmacy_conf'] }, turns:12,
  },
  {
    id:'sc-007', title:'Equipment fault — mask leak',
    scenario:'Returning customer, mask seal issues. Discovery + product knowledge.',
    qualityTier:'excellent', status:'ready',
    durationSeconds:168, ttsCharCount:1960, estimatedCost:0.5880,
    createdAt:'2026-04-17T16:12:00Z',
    config:{ circumstances:['equipment_fault'] },
    sentToAnalysisCallId:'call-9795', turns:13,
  },
  {
    id:'sc-008', title:'Failed generation — voice 429',
    scenario:'Retry after ElevenLabs rate-limit.',
    qualityTier:'acceptable', status:'failed',
    durationSeconds:null, ttsCharCount:1820, estimatedCost:null,
    createdAt:'2026-04-17T15:40:00Z',
    error:'ElevenLabs returned 429 after 3 retries. Check API key or wait 5 min.',
    config:{ circumstances:[] }, turns:10,
  },
];

// Voice bank — fake ElevenLabs voices
const VOICES = [
  { voice_id:'v1', name:'Rachel',    labels:{ gender:'female', age:'young',     accent:'american', description:'calm, professional' } },
  { voice_id:'v2', name:'Adam',      labels:{ gender:'male',   age:'middle',    accent:'american', description:'warm, measured' } },
  { voice_id:'v3', name:'Bella',     labels:{ gender:'female', age:'young',     accent:'american', description:'soft, friendly' } },
  { voice_id:'v4', name:'Antoni',    labels:{ gender:'male',   age:'young',     accent:'american', description:'upbeat, clear' } },
  { voice_id:'v5', name:'Arnold',    labels:{ gender:'male',   age:'middle',    accent:'american', description:'crisp, authoritative' } },
  { voice_id:'v6', name:'Domi',      labels:{ gender:'female', age:'young',     accent:'american', description:'energetic' } },
  { voice_id:'v7', name:'Elli',      labels:{ gender:'female', age:'young',     accent:'american', description:'emotive, gentle' } },
  { voice_id:'v8', name:'Josh',      labels:{ gender:'male',   age:'young',     accent:'american', description:'deep, reassuring' } },
  { voice_id:'v9', name:'Margaret',  labels:{ gender:'female', age:'senior',    accent:'american', description:'careful, gentle' } },
  { voice_id:'v10',name:'Rashad',    labels:{ gender:'male',   age:'middle',    accent:'american', description:'direct, fast' } },
  { voice_id:'v11',name:'Priya',     labels:{ gender:'female', age:'middle',    accent:'british',  description:'clear, articulate' } },
  { voice_id:'v12',name:'Marcus',    labels:{ gender:'male',   age:'middle',    accent:'british',  description:'warm, reflective' } },
];

const DAILY_USED = 3;
const DAILY_CAP  = 20;

// Default script scaffold
const EMPTY_SCRIPT = {
  title:'', scenario:'', qualityTier:'acceptable', equipment:'',
  voices:{ agent:'v2', customer:'v9' },
  turns:[
    { speaker:'agent', text:'Thank you for calling, how can I help?' },
    { speaker:'customer', text:'Hi, I had a question about my order.' },
  ],
};

Object.assign(window, { CIRCUMSTANCE_META, CIRCUMSTANCE_VALUES, SIMULATED_CALLS, VOICES, DAILY_USED, DAILY_CAP, EMPTY_SCRIPT });
