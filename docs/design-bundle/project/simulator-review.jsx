// Post-session review: rubric, moments, exemplar compare, next steps.

const SessionReview = ({ result, scenario, onReplay, onNext, onExit }) => {
  const persona = PERSONAS[scenario.persona];
  const [selMoment, setSelMoment] = React.useState(null);

  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:'32px 40px' }}>
      {/* Hero */}
      <div style={{ marginBottom:28 }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8 }}>Session review · {result.completedAt}</div>
        <h1 style={{ fontFamily:'var(--display)', fontSize:32, fontWeight:500, letterSpacing:-0.6, margin:0, color:'var(--ink)', lineHeight:1.15, textWrap:'pretty' }}>
          You met the moment. <span style={{color:'var(--muted)'}}>{scenario.title} · {Math.floor(result.durationSec/60)}:{String(result.durationSec%60).padStart(2,'0')}</span>
        </h1>
      </div>

      {/* Score hero + rubric */}
      <div style={{ display:'grid', gridTemplateColumns:'260px 1fr', gap:28, marginBottom:32 }}>
        <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'24px 24px', textAlign:'center' }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:12 }}>Overall</div>
          <ScoreDial value={result.rubric.overall} size={160} label="Score"/>
          <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--good)', marginTop:14 }}>▲ 0.8 vs last session</div>
        </div>
        <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'24px 28px' }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:18 }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em' }}>Rubric breakdown</div>
          </div>
          <RubricRack rubric={{
            compliance:result.rubric.compliance,
            customerExperience:result.rubric.empathy,
            communication:(result.rubric.pace+result.rubric.discovery)/2,
            resolution:result.rubric.close,
          }}/>
        </div>
      </div>

      {/* Moments */}
      <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'24px 28px', marginBottom:28 }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:14 }}>Specific moments</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {result.moments.map((m, i) => {
            const kindColor = m.kind==='win' ? 'var(--good)' : m.kind==='miss' ? 'var(--warn)' : 'var(--muted)';
            const kindLabel = m.kind==='win' ? 'Nailed it' : m.kind==='miss' ? 'Missed' : 'Consider';
            return (
              <div key={i} onClick={() => setSelMoment(i === selMoment ? null : i)} style={{
                display:'grid', gridTemplateColumns:'60px 130px 1fr auto', gap:14, alignItems:'center',
                padding:'12px 14px', borderLeft:`3px solid ${kindColor}`, background: selMoment===i ? 'var(--paper-2)' : 'transparent', cursor:'pointer',
              }}>
                <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>{m.t}</div>
                <div style={{ fontFamily:'var(--mono)', fontSize:9, color:kindColor, textTransform:'uppercase', letterSpacing:'0.12em', fontWeight:600 }}>{kindLabel}</div>
                <div>
                  <div style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:500, color:'var(--ink)' }}>{m.label}</div>
                  {selMoment===i && <div style={{ fontSize:12, color:'var(--muted)', marginTop:4, textWrap:'pretty', lineHeight:1.5 }}>{m.note}</div>}
                </div>
                <button className="icon-btn" onClick={e=>{e.stopPropagation(); onReplay(m);}} style={{padding:'6px 10px'}}>Replay alt →</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Exemplar compare + coaching update */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18, marginBottom:28 }}>
        <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'20px 24px' }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:12 }}>Vs exemplar</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:16, marginBottom:10 }}>
            <div>
              <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)' }}>YOU</div>
              <div style={{ fontFamily:'var(--display)', fontSize:30, fontWeight:500, color:'var(--ink)', fontVariantNumeric:'tabular-nums', letterSpacing:-1 }}>{result.compareExemplar.yourScore}</div>
            </div>
            <div style={{ flex:1, height:3, background:'var(--paper-2)', position:'relative', marginTop:18 }}>
              <div style={{ position:'absolute', left:0, top:0, bottom:0, width:(result.compareExemplar.yourScore/10*100)+'%', background:'var(--accent)' }}/>
              <div style={{ position:'absolute', left:(result.compareExemplar.exemplarScore/10*100)+'%', top:-4, bottom:-4, width:2, background:'var(--good)' }}/>
            </div>
            <div>
              <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--good)' }}>EXEMPLAR</div>
              <div style={{ fontFamily:'var(--display)', fontSize:30, fontWeight:500, color:'var(--good)', fontVariantNumeric:'tabular-nums', letterSpacing:-1 }}>{result.compareExemplar.exemplarScore}</div>
            </div>
          </div>
          <div style={{ fontSize:12, color:'var(--muted)', fontStyle:'italic', lineHeight:1.5, textWrap:'pretty' }}>{result.compareExemplar.gap}</div>
        </div>
        {result.coachingUpdate && (
          <div style={{ background:'oklch(96% 0.03 160)', border:'1px solid oklch(85% 0.06 160)', padding:'20px 24px' }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--good)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:10 }}>Coaching update</div>
            <div style={{ fontFamily:'var(--display)', fontSize:15, fontWeight:500, color:'var(--ink)', marginBottom:6, textWrap:'pretty' }}>Moved to {result.coachingUpdate.newStage}</div>
            <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.5, textWrap:'pretty' }}>{result.coachingUpdate.message}</div>
            <a href="Coaching.html" style={{ display:'inline-block', marginTop:10, fontFamily:'var(--mono)', fontSize:10, color:'var(--good)', textTransform:'uppercase', letterSpacing:'0.12em', textDecoration:'none' }}>Open coaching item →</a>
          </div>
        )}
      </div>

      {/* Next */}
      <div style={{ display:'flex', gap:10, alignItems:'center', padding:'20px 0', borderTop:'1px solid var(--line)' }}>
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:4 }}>Suggested next</div>
          <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, color:'var(--ink)' }}>{result.nextSuggested.title}</div>
          <div style={{ fontSize:12, color:'var(--muted)', fontStyle:'italic', textWrap:'pretty' }}>{result.nextSuggested.reason}</div>
        </div>
        <div style={{flex:1}}/>
        <button className="icon-btn" onClick={onExit}>Back to library</button>
        <button className="icon-btn primary" onClick={onNext} style={{padding:'10px 18px'}}>Start next →</button>
      </div>
    </div>
  );
};

Object.assign(window, { SessionReview });
