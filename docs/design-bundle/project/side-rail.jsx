// Side rail: AI summary, rubric rack, actions, topics, similar calls.
// Content varies by role: Agent view is coaching-forward; Manager view is QA + exemplars.

const SideRail = ({ role, playhead, onSeek }) => {
  const summary = role === 'agent' ? SUMMARY_AGENT : SUMMARY_MANAGER;

  return (
    <div style={{
      width:360, flexShrink:0,
      display:'flex', flexDirection:'column', gap:12,
      overflow:'auto',
    }}>
      {/* Score + rubric */}
      <Panel>
        <div style={{ display:'flex', alignItems:'center', gap:18 }}>
          <ScoreDial value={CALL_META.score} size={96} label="Score"/>
          <div style={{ flex:1 }}>
            <div style={sectionLabel}>AI verdict</div>
            <div style={{ fontFamily:'var(--display)', fontSize:18, fontWeight:500, letterSpacing:-0.3, color:'var(--ink)', lineHeight:1.2, marginTop:4 }}>
              {role === 'agent' ? 'Strong call' : 'Exemplar'}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:3, fontFamily:'var(--mono)', letterSpacing:'0.06em' }}>
              {role === 'manager' ? 'Coach-worthy • 1 minor miss' : '3 strengths • 1 to try'}
            </div>
          </div>
        </div>

        <div style={{ marginTop:22, paddingTop:18, borderTop:'1px solid var(--line)' }}>
          <div style={sectionLabel}>Rubric</div>
          <div style={{ marginTop:14, display:'flex', justifyContent:'center' }}>
            <RubricRack rubric={CALL_META.rubric} compact/>
          </div>
        </div>
      </Panel>

      {/* Summary */}
      <Panel>
        <div style={sectionLabel}>
          {role === 'agent' ? 'Your summary' : 'Call summary'}
          <span style={aiChip}>AI</span>
        </div>
        <div style={{ fontSize:13, lineHeight:1.6, color:'var(--ink)', marginTop:10, textWrap:'pretty' }}>
          {summary}
        </div>
      </Panel>

      {/* Coaching highlights (agent) / QA flags (manager) */}
      <Panel>
        <div style={sectionLabel}>
          {role === 'agent' ? 'Moments to revisit' : 'QA flags'}
        </div>
        <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:8 }}>
          {SEGMENTS.filter(s => s[5]).map((s, i) => {
            const coach = s[5];
            const color = coach.kind === 'good' ? 'var(--good)' : coach.kind === 'missed' ? 'var(--warn)' : 'var(--accent)';
            const active = playhead >= s[0] && playhead < s[1];
            return (
              <button
                key={i}
                onClick={() => onSeek(s[0])}
                style={{
                  display:'flex', gap:10, padding:'10px 12px',
                  background: active ? 'var(--accent-soft)' : 'var(--paper-2)',
                  border:`1px solid ${active ? color : 'var(--line)'}`,
                  borderLeft:`3px solid ${color}`,
                  cursor:'pointer', textAlign:'left',
                  fontFamily:'inherit',
                  transition:'border-color 0.15s',
                }}
              >
                <div style={{ color, paddingTop:1 }}><CoachIcon kind={coach.kind}/></div>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', fontVariantNumeric:'tabular-nums' }}>{fmtTime(s[0])}</span>
                    <span style={{ fontFamily:'var(--display)', fontSize:12, fontWeight:600, color:'var(--ink)' }}>{coach.label}</span>
                  </div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:3, lineHeight:1.45 }}>{coach.note}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* Actions & commitments */}
      <Panel>
        <div style={sectionLabel}>Commitments &amp; follow-ups</div>
        <div style={{ marginTop:10 }}>
          {ACTIONS.map((a, i) => (
            <div key={i} style={{
              display:'flex', gap:10, padding:'10px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--line)',
            }}>
              <div style={{
                marginTop:3,
                width:14, height:14, borderRadius:2,
                border:'1.5px solid var(--line)',
                background: a.status === 'committed' ? 'var(--accent)' : 'transparent',
                borderColor: a.status === 'committed' ? 'var(--accent)' : 'var(--line)',
                display:'flex', alignItems:'center', justifyContent:'center',
                flexShrink:0,
              }}>
                {a.status === 'committed' && (
                  <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.5 L4 7.5 L8 3" fill="none" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round"/></svg>
                )}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12.5, lineHeight:1.5, color:'var(--ink)' }}>{a.text}</div>
                <div style={{ display:'flex', gap:10, marginTop:4 }}>
                  <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em' }}>
                    {a.who === 'agent' ? 'Agent' : 'Patient'}
                  </span>
                  <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.1em' }}>
                    due {a.by}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Topics */}
      <Panel>
        <div style={sectionLabel}>Topics detected</div>
        <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:6 }}>
          {TOPICS.map((t, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ fontSize:12, color:'var(--ink)', minWidth:130, flex:1 }}>{t.name}</div>
              <div style={{ flex:1, height:4, background:'var(--paper-2)', borderRadius:2, overflow:'hidden' }}>
                <div style={{ width:`${t.weight*100}%`, height:'100%', background:'var(--accent)', opacity:0.7 }}/>
              </div>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', fontVariantNumeric:'tabular-nums', minWidth:30, textAlign:'right' }}>
                {Math.round(t.weight*100)}%
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Manager-only: similar exemplars */}
      {role === 'manager' && (
        <Panel>
          <div style={sectionLabel}>Similar exemplars</div>
          <div style={{ marginTop:10, display:'flex', flexDirection:'column' }}>
            {SIMILAR_CALLS.map((c, i) => (
              <a key={c.id} href="#" onClick={(e) => e.preventDefault()} style={{
                display:'flex', alignItems:'center', gap:10, padding:'10px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                textDecoration:'none', color:'inherit',
              }}>
                <div style={{
                  fontFamily:'var(--mono)', fontSize:11, fontWeight:600, color:'var(--good)',
                  fontVariantNumeric:'tabular-nums', width:30,
                }}>{c.score.toFixed(1)}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12.5, color:'var(--ink)', lineHeight:1.35 }}>{c.topic}</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', marginTop:2 }}>
                    {c.who} · {c.dur} · {c.when}
                  </div>
                </div>
                <svg width="12" height="12" viewBox="0 0 12 12" style={{ color:'var(--muted)' }}><path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </a>
            ))}
          </div>
        </Panel>
      )}

      {/* Agent-only: practice prompt */}
      {role === 'agent' && (
        <Panel style={{ background:'var(--accent-soft)', borderColor:'var(--accent)' }}>
          <div style={sectionLabel}>Try this in the simulator</div>
          <div style={{ fontSize:13, lineHeight:1.55, color:'var(--ink)', marginTop:8 }}>
            One 4-min practice on <b>verbal callback confirmation at close</b>. We'll grade you using the same rubric.
          </div>
          <button style={{
            marginTop:12,
            width:'100%', padding:'10px',
            background:'var(--accent)', color:'var(--paper)',
            border:'none', borderRadius:3, cursor:'pointer',
            fontFamily:'var(--display)', fontSize:13, fontWeight:500, letterSpacing:'0.02em',
          }}>
            Start 4-minute practice →
          </button>
        </Panel>
      )}
    </div>
  );
};

const Panel = ({ children, style }) => (
  <div style={{
    background:'var(--paper-card)',
    border:'1px solid var(--line)',
    padding:'16px 18px',
    ...style,
  }}>{children}</div>
);

const sectionLabel = {
  fontFamily:'var(--mono)', fontSize:10,
  color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:500,
  display:'flex', alignItems:'center', gap:8,
};

const aiChip = {
  fontFamily:'var(--mono)', fontSize:9,
  padding:'1px 5px', background:'var(--accent-soft)', color:'var(--accent)',
  borderRadius:2, letterSpacing:'0.1em',
};

Object.assign(window, { SideRail, Panel });
