// Shared UI pieces for the coaching page: progress rings, stage chips, item cards, etc.

// -------- Growth Ring: circular progress with stage dots --------
const GrowthRing = ({ stage, size=60, strokeW=4 }) => {
  const stages = ['open','plan','practice','evidence','signed-off'];
  const idx = stages.indexOf(stage);
  const r = size/2 - strokeW - 2;
  const c = 2 * Math.PI * r;
  const pct = (idx + 1) / stages.length;
  const off = c * (1 - pct);
  const signedOff = stage === 'signed-off';
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth={strokeW}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={signedOff ? 'var(--good)' : 'var(--accent)'} strokeWidth={strokeW} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" style={{transition:'stroke-dashoffset 0.4s'}}/>
        {/* stage dots around the ring */}
        {stages.map((s, i) => {
          const angle = (i / stages.length) * 2 * Math.PI - Math.PI/2;
          const dx = size/2 + r * Math.cos(angle);
          const dy = size/2 + r * Math.sin(angle);
          const active = i <= idx;
          return <circle key={s} cx={dx} cy={dy} r={2.5} fill={active ? (signedOff?'var(--good)':'var(--accent)') : 'var(--paper)'} stroke="var(--line)" strokeWidth="0.8" style={{transform:'rotate(90deg)', transformOrigin:`${size/2}px ${size/2}px`}}/>;
        })}
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize: size*0.18, fontWeight:600, color: signedOff ? 'var(--good)' : 'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{idx+1}/{stages.length}</div>
      </div>
    </div>
  );
};

// -------- Stage Chip --------
const StageChip = ({ stage, size='md' }) => {
  const colors = {
    'open':       { bg:'var(--paper-2)',   fg:'var(--muted)' },
    'plan':       { bg:'var(--accent-soft)', fg:'var(--accent)' },
    'practice':   { bg:'var(--accent-soft)', fg:'var(--accent)' },
    'evidence':   { bg:'var(--accent-soft)', fg:'var(--accent)' },
    'signed-off': { bg:'oklch(92% 0.05 160)', fg:'var(--good)' },
  };
  const c = colors[stage] || colors.open;
  const s = size === 'sm' ? { padding:'2px 7px', fontSize:9 } : { padding:'3px 9px', fontSize:10 };
  return <span style={{
    background:c.bg, color:c.fg, fontFamily:'var(--mono)',
    textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:500,
    borderRadius:2, ...s
  }}>{stage === 'signed-off' ? '✓ signed off' : stage}</span>;
};

// -------- Source pill: where the item came from --------
const SourceBadge = ({ source, assignedByName, compact }) => {
  const icons = { ai:'◈', theme:'❋', cadence:'◔', self:'✿', manager:'◆' };
  const labels = { ai:'AI-detected', theme:'Team theme', cadence:'Scheduled', self:'Self-flagged' };
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:6, fontFamily:'var(--mono)', fontSize: compact?9:10, color:'var(--muted)', letterSpacing:'0.06em', textTransform:'uppercase' }}>
      <span style={{ fontSize: compact?10:12, color:'var(--accent)' }}>{icons[source]}</span>
      <span>{labels[source] || source}{!compact && assignedByName ? ` · ${assignedByName}` : ''}</span>
    </div>
  );
};

// -------- Competency chip --------
const CompetencyChip = ({ id, compact }) => {
  const comp = COMPETENCIES.find(c => c.id === id);
  if (!comp) return null;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6,
      padding: compact ? '2px 7px' : '3px 9px',
      border:'1px solid var(--line)',
      background:'var(--paper-card)',
      borderRadius:2, fontFamily:'var(--mono)', fontSize: compact?9:10,
      color:'var(--ink)', letterSpacing:'0.04em', textTransform:'uppercase'
    }}>
      <span style={{ color:`oklch(55% 0.14 ${comp.hue})`, fontSize:12 }}>{comp.icon}</span>
      {comp.label}
    </span>
  );
};

// -------- Due pill --------
const DuePill = ({ days }) => {
  const overdue = days < 0;
  const urgent = days >= 0 && days <= 2;
  const color = overdue ? 'var(--warn)' : urgent ? 'var(--accent)' : 'var(--muted)';
  const label = overdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'due today' : `due in ${days}d`;
  return <span style={{ fontFamily:'var(--mono)', fontSize:10, color, letterSpacing:'0.04em' }}>{label}</span>;
};

// -------- Mini stage track: horizontal 5-step --------
const StageTrack = ({ stage, width=240 }) => {
  const stages = ['open','plan','practice','evidence','signed-off'];
  const idx = stages.indexOf(stage);
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, width }}>
      {stages.map((s, i) => {
        const done = i <= idx;
        const signedOff = stage === 'signed-off' && i <= idx;
        const color = signedOff ? 'var(--good)' : done ? 'var(--accent)' : 'var(--line)';
        return (
          <React.Fragment key={s}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, flex:'0 0 auto' }}>
              <div style={{ width:12, height:12, borderRadius:'50%', background: done ? color : 'var(--paper-card)', border: `1.5px solid ${color}` }}/>
              <div style={{ fontFamily:'var(--mono)', fontSize:9, color: done ? 'var(--ink)' : 'var(--muted)', letterSpacing:'0.04em', textTransform:'uppercase' }}>{s === 'signed-off' ? 'sign off' : s}</div>
            </div>
            {i < stages.length - 1 && <div style={{ flex:1, height:1.5, background: i < idx ? color : 'var(--line)', marginTop:-16 }}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// -------- Streak display — flames without emoji --------
const StreakPips = ({ count }) => (
  <div style={{ display:'flex', gap:3, alignItems:'center' }}>
    {Array.from({length: Math.min(count, 10)}).map((_, i) => (
      <div key={i} style={{ width:4, height: 10 + (i%3)*3, background:'var(--accent)', borderRadius:'1px', opacity: 0.4 + (i/10)*0.6 }}/>
    ))}
    {count > 10 && <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', marginLeft:4 }}>+{count-10}</span>}
  </div>
);

// -------- Competency radar chart (hexagon) --------
const CompetencyRadar = ({ scores, size=220, accent='var(--accent)' }) => {
  const cx = size/2, cy = size/2;
  const r = size/2 - 32;
  const n = COMPETENCIES.length;
  const points = COMPETENCIES.map((c, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI/2;
    const val = (scores[c.id] || 0) / 100;
    return [ cx + Math.cos(angle) * r * val, cy + Math.sin(angle) * r * val ];
  });
  const path = points.map((p, i) => (i===0?'M':'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + ' Z';

  // rings
  const rings = [0.25, 0.5, 0.75, 1.0];
  return (
    <svg width={size} height={size} style={{display:'block'}}>
      {rings.map(pct => {
        const pts = COMPETENCIES.map((c, i) => {
          const angle = (i / n) * 2 * Math.PI - Math.PI/2;
          return (cx + Math.cos(angle)*r*pct).toFixed(1) + ',' + (cy + Math.sin(angle)*r*pct).toFixed(1);
        }).join(' ');
        return <polygon key={pct} points={pts} fill="none" stroke="var(--line)" strokeWidth="1"/>;
      })}
      {COMPETENCIES.map((c, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI/2;
        return <line key={c.id} x1={cx} y1={cy} x2={cx + Math.cos(angle)*r} y2={cy + Math.sin(angle)*r} stroke="var(--line)" strokeWidth="1"/>;
      })}
      <path d={path} fill={accent} fillOpacity="0.15" stroke={accent} strokeWidth="1.8" strokeLinejoin="round"/>
      {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="var(--paper-card)" stroke={accent} strokeWidth="1.5"/>)}
      {COMPETENCIES.map((c, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI/2;
        const lx = cx + Math.cos(angle) * (r + 18);
        const ly = cy + Math.sin(angle) * (r + 18);
        const val = scores[c.id] || 0;
        return (
          <g key={c.id}>
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--muted)" textTransform="uppercase" style={{letterSpacing:'0.08em'}}>{c.label.split(' ')[0]}</text>
            <text x={lx} y={ly+12} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontFamily="var(--mono)" fill="var(--ink)" fontWeight="500">{val}</text>
          </g>
        );
      })}
    </svg>
  );
};

Object.assign(window, { GrowthRing, StageChip, SourceBadge, CompetencyChip, DuePill, StageTrack, StreakPips, CompetencyRadar });
