// Coaching item DETAIL view — modal / panel.
// The "rich card" with all sections: issue, evidence, suggested fix, practice, sign-off.

const CoachingDetail = ({ item, onClose, onStageAdvance }) => {
  if (!item) return null;
  const agent = item.agentId === '*team' ? { name:'Whole team', initials:'T' } : AGENTS.find(a => a.id === item.agentId);
  const comp = COMPETENCIES.find(c => c.id === item.competency);
  const stageIdx = ['open','plan','practice','evidence','signed-off'].indexOf(item.stage);
  const nextStage = ['open','plan','practice','evidence','signed-off'][stageIdx + 1];

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(20,16,12,0.4)',
      display:'flex', alignItems:'stretch', justifyContent:'flex-end', zIndex:50,
      animation:'fadeIn 0.15s ease-out',
    }} onClick={onClose}>
      <div style={{
        width:720, background:'var(--paper)', height:'100%', overflow:'auto',
        boxShadow:'-20px 0 60px rgba(0,0,0,0.2)',
        animation:'slideIn 0.25s ease-out',
      }} onClick={e => e.stopPropagation()}>

        {/* Top bar */}
        <div style={{ padding:'18px 32px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:14, background:'var(--paper-card)' }}>
          <StageChip stage={item.stage}/>
          <div style={{flex:1}}/>
          <button className="icon-btn" onClick={onClose} style={{ padding:'6px 10px' }}>esc ✕</button>
        </div>

        {/* Hero — growth copy + title */}
        <div style={{ padding:'32px 40px 24px', borderBottom:'1px solid var(--line)' }}>
          <div style={{ fontFamily:'var(--ui)', fontSize:14, fontStyle:'italic', color:'var(--accent)', marginBottom:10, textWrap:'pretty', maxWidth:520 }}>{item.growthCopy}</div>
          <h1 style={{ fontFamily:'var(--display)', fontSize:30, fontWeight:500, letterSpacing:-0.6, margin:'0 0 16px', color:'var(--ink)', lineHeight:1.15, textWrap:'pretty', maxWidth:560 }}>{item.title}</h1>

          <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
            <CompetencyChip id={item.competency}/>
            <SourceBadge source={item.source} assignedByName={item.assignedByName}/>
            <div style={{flex:1}}/>
            <DuePill days={item.dueDaysAway}/>
          </div>
        </div>

        {/* Stage track */}
        <div style={{ padding:'24px 40px', background:'var(--paper-card)', borderBottom:'1px solid var(--line)' }}>
          <StageTrack stage={item.stage} width={640}/>
        </div>

        {/* Section: What we noticed */}
        <DetailSection num="01" title="What we noticed">
          <p style={{ fontSize:14, lineHeight:1.65, color:'var(--ink)', margin:0, textWrap:'pretty' }}>{item.issue}</p>
          {item.evidenceCall && (
            <div style={{ marginTop:16, background:'var(--paper-card)', border:'1px solid var(--line)', padding:'14px 16px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ fontSize:24, color:'var(--accent)' }}>▶</div>
              <div style={{flex:1}}>
                <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Call clip</div>
                <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, color:'var(--ink)' }}>{item.evidenceCall.topic} <span style={{color:'var(--muted)', fontWeight:400}}>· {item.evidenceCall.at}</span></div>
                <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)', marginTop:2 }}>{item.evidenceCall.clip}{item.evidenceCall.sentimentShift !== 0 && <span style={{color:'var(--warn)', marginLeft:10}}>sentiment {item.evidenceCall.sentimentShift > 0 ? '+' : ''}{item.evidenceCall.sentimentShift}</span>}</div>
              </div>
              <button className="icon-btn" style={{padding:'7px 12px'}}>Open transcript →</button>
            </div>
          )}
        </DetailSection>

        {/* Section: Try this */}
        {item.suggestedFix && (
          <DetailSection num="02" title="Try this">
            <p style={{ fontSize:14, lineHeight:1.65, color:'var(--ink)', margin:0, textWrap:'pretty', fontStyle:'italic' }}>"{item.suggestedFix}"</p>
          </DetailSection>
        )}

        {/* Section: Practice */}
        {item.practiceLink && (
          <DetailSection num={item.suggestedFix ? '03' : '02'} title="Practice">
            <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'16px 18px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom: item.practice ? 14 : 0 }}>
                <div style={{ width:40, height:40, border:'1.5px solid var(--accent)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--accent)', fontSize:16 }}>{item.practiceLink.type === 'simulator' ? '◑' : '◇'}</div>
                <div style={{flex:1}}>
                  <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, color:'var(--ink)' }}>{item.practiceLink.scenario}</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)', marginTop:2 }}>{item.practiceLink.type === 'simulator' ? 'Simulator' : 'Reading'} · {item.practiceLink.duration}</div>
                </div>
                <button className="icon-btn primary" style={{padding:'9px 16px'}}>Start →</button>
              </div>
              {item.practice && (
                <div style={{ paddingTop:14, borderTop:'1px solid var(--line)', display:'flex', alignItems:'center', gap:14 }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:6 }}>
                      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Your practice</div>
                      <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{item.practice.scenariosCompleted} of {item.practice.targetScenarios} scenarios</div>
                    </div>
                    <div style={{ height:4, background:'var(--paper-2)', borderRadius:2, overflow:'hidden' }}>
                      <div style={{ width: (item.practice.scenariosCompleted / item.practice.targetScenarios * 100) + '%', height:'100%', background:'var(--accent)' }}/>
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Last score</div>
                    <div style={{ fontFamily:'var(--display)', fontSize:20, fontWeight:500, color:'var(--good)', fontVariantNumeric:'tabular-nums' }}>{item.practice.lastScore.toFixed(1)}</div>
                  </div>
                </div>
              )}
            </div>
          </DetailSection>
        )}

        {/* Section: Evidence */}
        {item.evidence && (
          <DetailSection num="04" title="Evidence of change" accent="good">
            <div style={{ background:'oklch(96% 0.03 160)', border:'1px solid oklch(85% 0.06 160)', padding:'16px 18px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:10 }}>
                <div style={{ fontFamily:'var(--display)', fontSize:28, fontWeight:500, color:'var(--good)', fontVariantNumeric:'tabular-nums' }}>{item.evidence.score}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, color:'var(--ink)' }}>Call {item.evidence.callId} showed the change.</div>
                  <div style={{ fontFamily:'var(--ui)', fontSize:13, color:'var(--muted)', fontStyle:'italic', marginTop:2, textWrap:'pretty' }}>{item.evidence.note}</div>
                </div>
              </div>
            </div>
          </DetailSection>
        )}

        {/* Action footer */}
        <div style={{ padding:'24px 40px 60px', borderTop:'1px solid var(--line)', background:'var(--paper-card)', display:'flex', gap:10, alignItems:'center', marginTop:14 }}>
          <Avatar initials={agent.initials} size={32}/>
          <div style={{flex:1}}>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Assigned to</div>
            <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, color:'var(--ink)' }}>{agent.name}</div>
          </div>
          {nextStage && item.stage !== 'signed-off' && (
            <button className="icon-btn primary" onClick={() => onStageAdvance(item.id, nextStage)} style={{padding:'10px 18px'}}>
              Move to {nextStage === 'signed-off' ? 'sign off' : nextStage} →
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes slideIn { from { transform:translateX(40px); opacity:0.6; } to { transform:translateX(0); opacity:1; } }
      `}</style>
    </div>
  );
};

const DetailSection = ({ num, title, children, accent }) => (
  <div style={{ padding:'24px 40px', borderBottom:'1px solid var(--line)' }}>
    <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:14 }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', letterSpacing:'0.12em' }}>{num}</div>
      <h3 style={{ fontFamily:'var(--display)', fontSize:12, fontWeight:600, margin:0, color: accent==='good'?'var(--good)':'var(--ink)', textTransform:'uppercase', letterSpacing:'0.14em' }}>{title}</h3>
    </div>
    {children}
  </div>
);

// ------- Assign New Modal -------
const AssignModal = ({ onClose }) => {
  const [agentId, setAgentId] = React.useState('e1');
  const [compId, setCompId]   = React.useState('empathy');
  const [source, setSource]   = React.useState('transcript');
  const [title, setTitle]     = React.useState('Acknowledge emotion before process');
  const [issue, setIssue]     = React.useState('On the CPAP intake call today, the response to the patient\'s frustration went straight to solution-mode. A brief acknowledgment would have shifted the tone.');
  const [growthCopy, setGrowthCopy] = React.useState('Patients feel heard when you name the hard part first.');
  const [attachCall, setAttachCall] = React.useState(true);

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(20,16,12,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:60,
    }} onClick={onClose}>
      <div style={{
        width:680, maxHeight:'90vh', overflow:'auto',
        background:'var(--paper-card)', border:'1px solid var(--line)',
      }} onClick={e => e.stopPropagation()}>
        {/* Top */}
        <div style={{ padding:'20px 28px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.14em' }}>New coaching item</div>
          <div style={{flex:1}}/>
          <button className="icon-btn" onClick={onClose}>esc ✕</button>
        </div>

        {/* Source pill — which call this came from */}
        {attachCall && (
          <div style={{ padding:'16px 28px', background:'var(--accent-soft)', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ fontSize:20, color:'var(--accent)' }}>⎘</div>
            <div style={{flex:1}}>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:2 }}>Attached from transcript</div>
              <div style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:500, color:'var(--ink)' }}>Status check · Alex Rivera · Today 09:22 · clip 01:08 – 01:34</div>
            </div>
            <button className="icon-btn" onClick={() => setAttachCall(false)} style={{padding:'6px 10px'}}>Detach</button>
          </div>
        )}

        {/* Form */}
        <div style={{ padding:'24px 28px', display:'flex', flexDirection:'column', gap:18 }}>
          <FieldRow label="Assign to">
            <select className="select" value={agentId} onChange={e => setAgentId(e.target.value)} style={{flex:1}}>
              {AGENTS.map(a => <option key={a.id} value={a.id}>{a.name} · {a.team}</option>)}
              <option value="*team">— Whole team —</option>
            </select>
          </FieldRow>
          <FieldRow label="Competency">
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {COMPETENCIES.map(c => (
                <button key={c.id} onClick={() => setCompId(c.id)} className="icon-btn" style={{
                  padding:'6px 12px',
                  background: compId === c.id ? 'var(--ink)' : 'transparent',
                  color: compId === c.id ? 'var(--paper)' : 'var(--ink)',
                  borderColor: compId === c.id ? 'var(--ink)' : 'var(--line)',
                }}>{c.icon} {c.label}</button>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Title">
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={{flex:1, fontFamily:'var(--ui)', fontSize:14}}/>
          </FieldRow>
          <FieldRow label="Warm framing" sub="How we'll introduce this to them — aim for growth, not criticism.">
            <textarea value={growthCopy} onChange={e => setGrowthCopy(e.target.value)} rows={2} style={{
              flex:1, border:'1px solid var(--line)', padding:'8px 10px',
              fontFamily:'var(--ui)', fontSize:13, fontStyle:'italic', color:'var(--ink)', resize:'vertical',
              background:'var(--paper-card)', borderRadius:2,
            }}/>
          </FieldRow>
          <FieldRow label="What we noticed">
            <textarea value={issue} onChange={e => setIssue(e.target.value)} rows={4} style={{
              flex:1, border:'1px solid var(--line)', padding:'8px 10px',
              fontFamily:'var(--ui)', fontSize:13, color:'var(--ink)', resize:'vertical',
              background:'var(--paper-card)', borderRadius:2, lineHeight:1.5,
            }}/>
          </FieldRow>
          <FieldRow label="Practice">
            <select className="select" defaultValue="simulator" style={{flex:1}}>
              <option value="simulator">Simulator — acknowledgment-first opener (~10 min)</option>
              <option value="reading">Reading — empathy micro-refresher (3 min)</option>
              <option value="none">No practice — just awareness</option>
            </select>
          </FieldRow>
        </div>

        {/* Footer */}
        <div style={{ padding:'20px 28px', borderTop:'1px solid var(--line)', background:'var(--paper-2)', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', letterSpacing:'0.04em' }}>Alex will see this in their inbox.</div>
          <div style={{flex:1}}/>
          <button className="icon-btn" onClick={onClose}>Cancel</button>
          <button className="icon-btn primary" onClick={onClose} style={{padding:'9px 16px'}}>Send coaching →</button>
        </div>
      </div>
    </div>
  );
};

const FieldRow = ({ label, sub, children }) => (
  <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:18, alignItems:'start' }}>
    <div style={{ paddingTop:8 }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em' }}>{label}</div>
      {sub && <div style={{ fontFamily:'var(--ui)', fontSize:11, color:'var(--muted)', fontStyle:'italic', marginTop:6, textWrap:'pretty' }}>{sub}</div>}
    </div>
    <div style={{ display:'flex' }}>{children}</div>
  </div>
);

Object.assign(window, { CoachingDetail, AssignModal });
