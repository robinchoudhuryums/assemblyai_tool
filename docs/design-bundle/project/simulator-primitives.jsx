// Shared UI primitives for the simulator.

// Patient mood waveform — live sentiment curve that "breathes."
const MoodWaveform = ({ data, width=320, height=60, active=false }) => {
  const pad = 4;
  const w = width - pad*2, h = height - pad*2;
  const n = data.length;
  const x = (i) => pad + (i/(Math.max(n-1,1)))*w;
  const y = (v) => pad + (1 - (v+1)/2) * h;
  let d = '';
  for (let i=0;i<n;i++){
    const px = x(i), py = y(data[i]);
    if (i===0) d += `M${px},${py}`;
    else {
      const [qx, qy] = [x(i-1), y(data[i-1])];
      const mx = (px+qx)/2;
      d += ` Q${mx},${qy} ${mx},${(py+qy)/2} T${px},${py}`;
    }
  }
  const lastV = data[data.length-1];
  const lastColor = lastV < -0.3 ? 'var(--warn)' : lastV > 0.3 ? 'var(--good)' : 'var(--accent)';
  return (
    <svg width={width} height={height} style={{display:'block'}}>
      <line x1={pad} x2={width-pad} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="2 3"/>
      <path d={d} fill="none" stroke={lastColor} strokeWidth="1.8" strokeLinecap="round" opacity={active?1:0.7}/>
      {n > 0 && <circle cx={x(n-1)} cy={y(lastV)} r="3" fill={lastColor}>
        {active && <animate attributeName="r" values="3;5;3" dur="1.8s" repeatCount="indefinite"/>}
      </circle>}
    </svg>
  );
};

// Live rubric gauge — a thin bar that fills as the session progresses
const RubricGauge = ({ label, value, max=10, color='var(--accent)' }) => {
  const pct = Math.min(value/max, 1) * 100;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em' }}>{label}</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{value ? value.toFixed(1) : '—'}</div>
      </div>
      <div style={{ height:3, background:'var(--paper-2)', overflow:'hidden' }}>
        <div style={{ width:pct+'%', height:'100%', background:color, transition:'width 0.4s' }}/>
      </div>
    </div>
  );
};

// Transcript bubble
const TranscriptBubble = ({ who, line, t, mood, highlight }) => {
  const isPatient = who === 'patient';
  return (
    <div style={{
      display:'flex', flexDirection: isPatient ? 'row' : 'row-reverse',
      gap:12, marginBottom:14, alignItems:'flex-start',
    }}>
      <div style={{ flex:'0 0 46px', textAlign:'center' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)' }}>{t}</div>
      </div>
      <div style={{
        maxWidth:'70%',
        background: isPatient ? 'var(--paper-card)' : 'var(--ink)',
        color: isPatient ? 'var(--ink)' : 'var(--paper)',
        border: isPatient ? '1px solid var(--line)' : 'none',
        padding:'11px 14px',
        fontSize:14, lineHeight:1.5,
        outline: highlight ? '2px solid var(--accent)' : 'none',
        outlineOffset:2,
      }}>{line}</div>
    </div>
  );
};

// Choice option card — for multiple-choice branching
const ChoiceCard = ({ option, onPick, revealed, picked }) => {
  const scoreColor = option.score === 'exemplar' ? 'var(--good)' : option.score === 'miss' ? 'var(--warn)' : 'var(--muted)';
  const scoreLabel = option.score === 'exemplar' ? 'Exemplar' : option.score === 'miss' ? 'Miss' : 'OK';
  return (
    <div
      onClick={() => !revealed && onPick(option)}
      style={{
        background:'var(--paper-card)',
        border:'1px solid',
        borderColor: revealed ? (picked ? scoreColor : 'var(--line)') : 'var(--line)',
        borderLeft: revealed ? `3px solid ${scoreColor}` : '1px solid var(--line)',
        padding:'14px 18px',
        cursor: revealed ? 'default' : 'pointer',
        opacity: revealed && !picked ? 0.5 : 1,
        transition:'all 0.15s',
      }}
      onMouseEnter={e => !revealed && (e.currentTarget.style.background='var(--paper-2)')}
      onMouseLeave={e => !revealed && (e.currentTarget.style.background='var(--paper-card)')}
    >
      <div style={{ fontSize:14, lineHeight:1.5, color:'var(--ink)', marginBottom: revealed ? 10 : 0, textWrap:'pretty' }}>"{option.text}"</div>
      {revealed && (
        <div style={{ display:'flex', alignItems:'center', gap:10, paddingTop:8, borderTop:'1px solid var(--line)' }}>
          <span style={{ fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.12em', color:scoreColor, fontWeight:600 }}>{scoreLabel}</span>
          {option.rubricHit && option.rubricHit.map(r => <span key={r} style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--good)', textTransform:'uppercase', letterSpacing:'0.08em' }}>+{r}</span>)}
          {option.rubricMiss && option.rubricMiss.map(r => <span key={r} style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--warn)', textTransform:'uppercase', letterSpacing:'0.08em' }}>−{r}</span>)}
          {option.note && <div style={{ fontSize:11, color:'var(--muted)', fontStyle:'italic', marginLeft:'auto', maxWidth:300, textWrap:'pretty' }}>{option.note}</div>}
        </div>
      )}
    </div>
  );
};

// Patient avatar — big, animated-ish circle with mood ring
const PatientAvatar = ({ persona, mood=0, size=96, speaking=false }) => {
  const ringColor = mood < -0.2 ? 'var(--warn)' : mood > 0.2 ? 'var(--good)' : 'var(--muted)';
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      {speaking && (
        <div style={{
          position:'absolute', inset:-8, borderRadius:'50%',
          border:`2px solid ${ringColor}`, opacity:0.4,
          animation:'pulse 1.5s ease-out infinite',
        }}/>
      )}
      <div style={{
        width:size, height:size, borderRadius:'50%',
        background:'var(--paper-2)', border:`2px solid ${ringColor}`,
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'var(--display)', fontSize:size*0.32, fontWeight:500,
        color:'var(--ink)',
      }}>{persona.avatar}</div>
      <style>{`@keyframes pulse { 0% { transform:scale(1); opacity:0.6 } 100% { transform:scale(1.25); opacity:0 } }`}</style>
    </div>
  );
};

// Coach whisper — inline hint card
const CoachWhisper = ({ hint }) => (
  <div style={{
    background:'oklch(96% 0.05 55)', border:'1px dashed var(--accent)',
    padding:'10px 14px',
    display:'flex', gap:10, alignItems:'flex-start',
    fontFamily:'var(--ui)', fontSize:12, lineHeight:1.4, color:'var(--ink)',
  }}>
    <div style={{ color:'var(--accent)', fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.12em', flexShrink:0, paddingTop:1 }}>hint</div>
    <div style={{textWrap:'pretty'}}>{hint}</div>
  </div>
);

// Difficulty chip
const DifficultyChip = ({ id }) => {
  const d = SCENARIO_DIFFICULTY.find(x => x.id === id);
  if (!d) return null;
  return <span style={{
    fontFamily:'var(--mono)', fontSize:9, letterSpacing:'0.1em',
    textTransform:'uppercase', padding:'2px 7px',
    border:`1px solid ${d.color}`, color:d.color, borderRadius:2,
  }}>{d.label}</span>;
};

// Competency chip
const CompetencyChip = ({ id, compact }) => {
  const c = (window.COMPETENCIES || []).find(x => x.id === id);
  if (!c) return null;
  return <span style={{
    fontFamily:'var(--mono)', fontSize:9, letterSpacing:'0.1em',
    textTransform:'uppercase', padding: compact ? '2px 7px' : '3px 8px',
    background:'var(--paper-2)', color:'var(--muted)', borderRadius:2,
  }}>{c.label}</span>;
};

// Score dial — circular gauge for overall score
const ScoreDial = ({ value, max=10, size=160, label }) => {
  const r = size/2 - 12;
  const c = 2 * Math.PI * r;
  const pct = Math.min(value/max, 1);
  return (
    <div style={{ position:'relative', width:size, height:size, margin:'0 auto' }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--paper-2)" strokeWidth="8"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--accent)" strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={c * (1-pct)} strokeLinecap="round"/>
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontFamily:'var(--display)', fontSize:size*0.32, fontWeight:500, color:'var(--ink)', letterSpacing:-1.5, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{value.toFixed(1)}</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.14em', marginTop:4 }}>{label || 'of 10'}</div>
      </div>
    </div>
  );
};

// Rubric rack — stacked horizontal bars
const RubricRack = ({ rubric }) => {
  const keys = Object.keys(rubric);
  const labels = { compliance:'Compliance', customerExperience:'Customer experience', communication:'Communication', resolution:'Resolution & next steps', empathy:'Empathy', pace:'Pace', discovery:'Discovery', product:'Product', close:'Close' };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {keys.map(k => {
        const v = rubric[k];
        const pct = Math.min(v/10, 1) * 100;
        return (
          <div key={k}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
              <div style={{ fontFamily:'var(--ui)', fontSize:12, color:'var(--ink)', fontWeight:500 }}>{labels[k] || k}</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{v.toFixed(1)}<span style={{color:'var(--muted)'}}> / 10</span></div>
            </div>
            <div style={{ height:6, background:'var(--paper-2)', position:'relative' }}>
              <div style={{ position:'absolute', left:0, top:0, bottom:0, width:pct+'%', background:'var(--accent)' }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
};

Object.assign(window, { MoodWaveform, RubricGauge, TranscriptBubble, ChoiceCard, PatientAvatar, CoachWhisper, DifficultyChip, CompetencyChip, ScoreDial, RubricRack });
