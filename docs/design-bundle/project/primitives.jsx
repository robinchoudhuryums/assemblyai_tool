// Shared primitives: typography, sparklines, score dials, sentiment curve, etc.

const Sparkline = ({ data, width=80, height=24, stroke='currentColor', fill='none' }) => {
  const clean = data.filter(v => v != null);
  if (clean.length < 2) return null;
  const min = Math.min(...clean), max = Math.max(...clean);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v,i) => v == null ? null : [i*step, height - ((v-min)/range)*(height-2) - 1]);
  let d = '';
  pts.forEach((p,i) => { if (!p) return; d += (d ? ' L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); });
  return <svg width={width} height={height} style={{display:'block'}}><path d={d} fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
};

// Continuous sentiment curve across 24h, with call volume as subtle bars underneath.
const SentimentCurve = ({ sentiment, volume, width=720, height=160, accent='var(--accent)' }) => {
  const pad = { l: 32, r: 16, t: 16, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const n = sentiment.length;
  const x = (i) => pad.l + (i/(n-1))*w;
  const y = (v) => pad.t + (1 - (v+1)/2)*h;
  const maxVol = Math.max(...volume, 1);

  // smooth curve through non-null points
  const pts = sentiment.map((v,i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
  let d = '';
  for (let i=0;i<pts.length;i++){
    const [px,py] = pts[i];
    if (i===0) d += `M${px},${py}`;
    else {
      const [qx,qy] = pts[i-1];
      const mx = (px+qx)/2;
      d += ` Q${mx},${qy} ${mx},${(py+qy)/2} T${px},${py}`;
    }
  }
  const area = d + ` L${x(n-1)},${y(0)} L${x(0)},${y(0)} Z`;

  return (
    <svg width={width} height={height} style={{display:'block'}}>
      {/* zero line */}
      <line x1={pad.l} x2={width-pad.r} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeDasharray="2 3"/>
      {/* y ticks */}
      <text x={pad.l-6} y={y(1)+3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">+1</text>
      <text x={pad.l-6} y={y(0)+3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">0</text>
      <text x={pad.l-6} y={y(-1)+3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">-1</text>
      {/* volume bars at bottom */}
      {volume.map((v,i) => {
        const bh = (v/maxVol) * 22;
        return <rect key={i} x={x(i)-3} y={height-pad.b+2} width="6" height={bh} fill="var(--line)" opacity="0.6"/>;
      })}
      {/* hour labels */}
      {[0,6,12,18,23].map(i => (
        <text key={i} x={x(i)} y={height-2} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--mono)">{String(i).padStart(2,'0')}:00</text>
      ))}
      {/* sentiment area */}
      <path d={area} fill={accent} opacity="0.08"/>
      <path d={d} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {/* dots */}
      {sentiment.map((v,i) => v == null ? null : (
        <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="var(--paper)" stroke={accent} strokeWidth="1.5"/>
      ))}
    </svg>
  );
};

// Vertical rubric rack — four bars
const RubricRack = ({ rubric, compact=false }) => {
  const entries = [
    ['Compliance', rubric.compliance],
    ['Customer Exp.', rubric.customerExperience],
    ['Communication', rubric.communication],
    ['Resolution', rubric.resolution],
  ];
  const barH = compact ? 120 : 160;
  return (
    <div style={{ display:'flex', gap: compact ? 18 : 28, alignItems:'flex-end' }}>
      {entries.map(([name, val]) => {
        const pct = (val/10)*100;
        const low = val < 7;
        return (
          <div key={name} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--ink)', fontVariantNumeric:'tabular-nums', fontWeight:500 }}>{val.toFixed(1)}</div>
            <div style={{ width:20, height:barH, background:'var(--paper-2)', border:'1px solid var(--line)', position:'relative' }}>
              <div style={{ position:'absolute', bottom:0, left:0, right:0, height: pct+'%', background: low ? 'var(--warn)' : 'var(--accent)' }}/>
              {/* ticks every 2.5 */}
              {[2.5,5,7.5].map(t => (
                <div key={t} style={{ position:'absolute', left:-3, right:-3, bottom: (t/10)*barH, height:1, background:'var(--line)', opacity:0.6 }}/>
              ))}
            </div>
            <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em', writingMode: compact ? 'horizontal-tb' : 'horizontal-tb', textAlign:'center', maxWidth:68, lineHeight:1.2 }}>{name}</div>
          </div>
        );
      })}
    </div>
  );
};

// Circular score dial
const ScoreDial = ({ value, size=120, label='Score' }) => {
  const r = size/2 - 8;
  const c = 2*Math.PI*r;
  const pct = value/10;
  const off = c * (1-pct);
  const color = value >= 8.5 ? 'var(--good)' : value >= 7 ? 'var(--accent)' : 'var(--warn)';
  return (
    <div style={{ position:'relative', width:size, height:size }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth="3"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"/>
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontFamily:'var(--display)', fontSize:size*0.32, fontWeight:500, color:'var(--ink)', fontVariantNumeric:'tabular-nums', letterSpacing:-1 }}>{value.toFixed(1)}</div>
        <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginTop:-4 }}>{label}</div>
      </div>
    </div>
  );
};

const SentimentDot = ({ kind }) => {
  const c = kind==='positive' ? 'var(--good)' : kind==='negative' ? 'var(--warn)' : 'var(--muted)';
  return <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:c }}/>;
};

const Avatar = ({ initials, size=28 }) => (
  <div style={{
    width:size, height:size, borderRadius:'50%',
    background:'var(--paper-2)', border:'1px solid var(--line)',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize: size*0.38, fontWeight:500, color:'var(--ink)', fontFamily:'var(--display)'
  }}>{initials}</div>
);

// Small stat: label + big number + sparkline
const StatBlock = ({ label, value, unit, delta, spark, sparkColor }) => (
  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
    <div style={{ fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em' }}>{label}</div>
    <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
      <div style={{ fontFamily:'var(--display)', fontSize:32, fontWeight:500, letterSpacing:-1, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{value}</div>
      {unit && <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--muted)' }}>{unit}</div>}
    </div>
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      {delta != null && (
        <div style={{ fontFamily:'var(--mono)', fontSize:11, color: delta>=0 ? 'var(--good)' : 'var(--warn)', fontVariantNumeric:'tabular-nums' }}>
          {delta>=0?'▲':'▼'} {Math.abs(delta).toFixed(1)}
        </div>
      )}
      {spark && <div style={{ color: sparkColor || 'var(--accent)' }}><Sparkline data={spark} width={90} height={18} stroke="currentColor"/></div>}
    </div>
  </div>
);

Object.assign(window, { Sparkline, SentimentCurve, RubricRack, ScoreDial, SentimentDot, Avatar, StatBlock });
