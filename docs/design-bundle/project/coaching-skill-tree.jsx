// Variant C — Skill Tree.
// Novel: competencies visualized as an organic growth diagram.
// Each competency is a "branch" — items stack up as leaves along it.
// Position on branch = mastery level. Open items pulse. Signed-off items are filled.

const SkillTree = ({ items, agentId, onOpenItem }) => {
  const scores = COMPETENCY_SCORES[agentId] || {};
  const agent = AGENTS.find(a => a.id === agentId);
  const mine = items.filter(i => i.agentId === agentId || i.agentId === '*team');

  // group items by competency
  const byComp = {};
  COMPETENCIES.forEach(c => { byComp[c.id] = []; });
  mine.forEach(i => { if (byComp[i.competency]) byComp[i.competency].push(i); });

  const [hoverItem, setHoverItem] = React.useState(null);

  // Layout: 6 branches radiating from a center trunk, 3 left / 3 right
  const W = 980, H = 640;
  const trunkX = W/2, trunkY = H/2;

  const branchLayout = COMPETENCIES.map((c, i) => {
    // alternate left/right, top to bottom
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i/2);
    const baseY = trunkY - 180 + row * 180;
    const tipX = trunkX + side * 360;
    const tipY = baseY;
    return { comp:c, side, baseY, tipX, tipY };
  });

  return (
    <div style={{ padding:'24px 40px', maxWidth:1400, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:20, gap:24 }}>
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8 }}>Your growth — {agent.name}</div>
          <h1 style={{ fontFamily:'var(--display)', fontSize:32, fontWeight:500, letterSpacing:-0.6, margin:0, color:'var(--ink)', lineHeight:1.15, textWrap:'pretty' }}>
            Six branches. <span style={{color:'var(--muted)'}}>Each item is a leaf. Let's see where you're growing.</span>
          </h1>
        </div>
        <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)', display:'flex', gap:18 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{width:10,height:10,borderRadius:'50%',border:'2px solid var(--accent)',background:'var(--paper-card)'}}/>
            <span>Open</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{width:10,height:10,borderRadius:'50%',background:'var(--accent)'}}/>
            <span>In progress</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{width:10,height:10,borderRadius:'50%',background:'var(--good)'}}/>
            <span>Signed off</span>
          </div>
        </div>
      </div>

      {/* Tree */}
      <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', position:'relative', overflow:'hidden' }}>
        <svg width={W} height={H} style={{ display:'block', margin:'0 auto' }}>
          {/* subtle grid dots */}
          <defs>
            <pattern id="dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="0" cy="0" r="0.5" fill="var(--line)"/>
            </pattern>
            <radialGradient id="trunkGlow">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25"/>
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <rect width={W} height={H} fill="url(#dots)" opacity="0.5"/>

          {/* Trunk glow */}
          <circle cx={trunkX} cy={trunkY} r="90" fill="url(#trunkGlow)"/>

          {/* Branches */}
          {branchLayout.map(({comp, side, baseY, tipX, tipY}) => {
            const mastery = (scores[comp.id] || 0) / 100;
            const branchLen = 360;
            // curved branch from trunk to tip
            const cx1 = trunkX + side * 60;
            const cy1 = trunkY + (baseY - trunkY) * 0.3;
            const cx2 = trunkX + side * 260;
            const cy2 = baseY;
            const branchPath = `M ${trunkX} ${trunkY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${tipX} ${tipY}`;

            // "filled" portion of branch = mastery
            return (
              <g key={comp.id}>
                {/* unfilled branch */}
                <path d={branchPath} fill="none" stroke="var(--line)" strokeWidth="2" strokeLinecap="round"/>
                {/* filled portion using dasharray trick */}
                <path d={branchPath} fill="none" stroke={`oklch(55% 0.14 ${comp.hue})`} strokeWidth="2.5" strokeLinecap="round"
                      strokeDasharray={branchLen} strokeDashoffset={branchLen * (1 - mastery)}/>

                {/* Competency label at tip */}
                <g transform={`translate(${tipX + side * 14}, ${tipY})`}>
                  <text textAnchor={side === 1 ? 'start' : 'end'} fontFamily="var(--display)" fontSize="14" fontWeight="500" fill="var(--ink)" dy="-6">{comp.label}</text>
                  <text textAnchor={side === 1 ? 'start' : 'end'} fontFamily="var(--mono)" fontSize="11" fill="var(--muted)" dy="10">{scores[comp.id] || 0} / 100</text>
                </g>

                {/* Leaves — items along the branch */}
                {byComp[comp.id].map((item, idx) => {
                  const stageIdx = ['open','plan','practice','evidence','signed-off'].indexOf(item.stage);
                  // position along branch: later stages = closer to tip
                  const t = 0.25 + stageIdx * 0.16 + (idx * 0.04);
                  // eval point on cubic bezier
                  const p = cubicBezier([trunkX, trunkY], [cx1, cy1], [cx2, cy2], [tipX, tipY], t);
                  // offset perpendicular for multiple items
                  const perpAngle = bezierTangent([trunkX, trunkY], [cx1, cy1], [cx2, cy2], [tipX, tipY], t) + Math.PI/2;
                  const offset = (idx % 2 === 0 ? 1 : -1) * 16 * Math.ceil((idx+1)/2);
                  const lx = p[0] + Math.cos(perpAngle) * offset;
                  const ly = p[1] + Math.sin(perpAngle) * offset;
                  const done = item.stage === 'signed-off';
                  const inProg = ['plan','practice','evidence'].includes(item.stage);
                  const fillColor = done ? 'var(--good)' : inProg ? 'var(--accent)' : 'var(--paper-card)';
                  return (
                    <g key={item.id} style={{cursor:'pointer'}}
                       onClick={() => onOpenItem(item.id)}
                       onMouseEnter={() => setHoverItem(item)}
                       onMouseLeave={() => setHoverItem(null)}
                    >
                      {/* stem */}
                      <line x1={p[0]} y1={p[1]} x2={lx} y2={ly} stroke={`oklch(55% 0.14 ${comp.hue})`} strokeWidth="1" opacity="0.5"/>
                      {/* leaf / dot */}
                      <circle cx={lx} cy={ly} r={item.stage === 'open' ? 6 : 8} fill={fillColor} stroke={done ? 'var(--good)' : 'var(--accent)'} strokeWidth="2">
                        {item.stage === 'open' && <animate attributeName="r" values="6;8;6" dur="2s" repeatCount="indefinite"/>}
                      </circle>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* Trunk — agent */}
          <circle cx={trunkX} cy={trunkY} r="42" fill="var(--paper-card)" stroke="var(--ink)" strokeWidth="2"/>
          <text x={trunkX} y={trunkY} textAnchor="middle" dominantBaseline="central" fontFamily="var(--display)" fontSize="18" fontWeight="500" fill="var(--ink)">{agent.initials}</text>
          <text x={trunkX} y={trunkY + 62} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--muted)" style={{letterSpacing:'0.12em', textTransform:'uppercase'}}>{mine.length} items · {mine.filter(i=>i.stage==='signed-off').length} closed</text>
        </svg>

        {/* Hover tooltip */}
        {hoverItem && (
          <div style={{
            position:'absolute', top:16, right:16, width:280,
            background:'var(--ink)', color:'var(--paper)',
            padding:'14px 16px', borderRadius:2,
            fontFamily:'var(--ui)', fontSize:12,
            pointerEvents:'none',
          }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.12em', opacity:0.6, marginBottom:6 }}>{hoverItem.stage}</div>
            <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, marginBottom:6, letterSpacing:-0.1 }}>{hoverItem.title}</div>
            <div style={{ fontStyle:'italic', opacity:0.75, fontSize:11, lineHeight:1.4, textWrap:'pretty' }}>{hoverItem.growthCopy}</div>
          </div>
        )}
      </div>

      {/* Competency summary grid below tree */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:14, marginTop:20 }}>
        {COMPETENCIES.map(c => {
          const items = byComp[c.id];
          const active = items.filter(i => i.stage !== 'signed-off').length;
          return (
            <div key={c.id} style={{
              background:'var(--paper-card)', border:'1px solid var(--line)',
              borderTop: `2px solid oklch(55% 0.14 ${c.hue})`,
              padding:'14px 16px',
            }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>{c.label}</div>
              <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:4 }}>
                <div style={{ fontFamily:'var(--display)', fontSize:28, fontWeight:500, color:'var(--ink)', letterSpacing:-1, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{scores[c.id] || 0}</div>
                <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>/ 100</div>
              </div>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color: active > 0 ? 'var(--accent)' : 'var(--muted)' }}>{active} active</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// cubic bezier helpers
function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const x = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0];
  const y = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1];
  return [x, y];
}
function bezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const dx = 3*u*u*(p1[0]-p0[0]) + 6*u*t*(p2[0]-p1[0]) + 3*t*t*(p3[0]-p2[0]);
  const dy = 3*u*u*(p1[1]-p0[1]) + 6*u*t*(p2[1]-p1[1]) + 3*t*t*(p3[1]-p2[1]);
  return Math.atan2(dy, dx);
}

Object.assign(window, { SkillTree });
