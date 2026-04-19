// Variant 2: PULSE — supervisor, viz-led, hero sentiment curve + hero score

const V2Pulse = () => {
  return (
    <div className="variant" style={{ width: 1440, minHeight: 900, background:'var(--paper)', color:'var(--ink)', fontFamily:'var(--ui)' }}>
      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 56px', borderBottom:'1px solid var(--line)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:40 }}>
          <div style={{ fontFamily:'var(--display)', fontSize:22, fontWeight:500, letterSpacing:-0.5 }}>
            UMS <span style={{ color:'var(--muted)', fontWeight:400 }}>/ Pulse</span>
          </div>
          <div style={{ display:'flex', gap:28 }}>
            {['Today','Calls','Agents','Coaching','Reports'].map((n,i) => (
              <div key={n} style={{ fontSize:13, color: i===0 ? 'var(--ink)' : 'var(--muted)', fontWeight: i===0?500:400, position:'relative', paddingBottom:4, borderBottom: i===0 ? '1.5px solid var(--accent)' : 'none' }}>{n}</div>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>Thu · Apr 18 · 14:02</div>
          <div style={{ width:1, height:16, background:'var(--line)' }}/>
          <Avatar initials="MA" size={28}/>
        </div>
      </div>

      <div style={{ padding:'40px 56px 48px' }}>
        {/* Hero: score + sentiment curve */}
        <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:56, alignItems:'center', paddingBottom:40, borderBottom:'1px solid var(--line)' }}>
          {/* Left: hero score + label */}
          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)' }}>Team pulse · 24h</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:8, marginTop:8 }}>
              <div style={{ fontFamily:'var(--display)', fontSize:96, fontWeight:500, letterSpacing:-4, lineHeight:0.95, color:'var(--ink)', fontVariantNumeric:'tabular-nums' }}>8.1</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:16, color:'var(--muted)' }}>/10</div>
            </div>
            <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--good)' }}>▲ 0.3 vs. yesterday</div>
              <div style={{ width:1, height:10, background:'var(--line)' }}/>
              <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--muted)' }}>+0.6 wk</div>
            </div>
            <div style={{ marginTop:28, fontSize:14, lineHeight:1.55, color:'var(--ink)', maxWidth:280 }}>
              Volume up <strong>12%</strong> driven by CPAP intake. Two Oxygen calls missed HIPAA verification — both <strong>Wren H</strong>. Billing de-escalations by <span style={{ background:'var(--accent-soft)', padding:'0 3px' }}>Priya S.</span> worth sharing.
            </div>
            <div style={{ marginTop:16, display:'flex', gap:10 }}>
              <button style={btnPrimary}>Draft coaching note</button>
              <button style={btnGhost}>Open ledger</button>
            </div>
          </div>

          {/* Right: sentiment curve hero */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:16 }}>
              <div>
                <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)' }}>Live · sentiment curve</div>
                <div style={{ fontFamily:'var(--display)', fontSize:24, fontWeight:500, letterSpacing:-0.3, marginTop:2 }}>Today, hour-by-hour</div>
              </div>
              <div style={{ display:'flex', gap:16, fontFamily:'var(--mono)', fontSize:11 }}>
                <span style={{ color:'var(--good)' }}>● +0.61 peak 11:00</span>
                <span style={{ color:'var(--warn)' }}>● −0.34 trough 15:00</span>
              </div>
            </div>
            <SentimentCurve sentiment={SENTIMENT_CURVE} volume={VOLUME} width={920} height={220} accent="var(--accent)"/>
          </div>
        </div>

        {/* Cards grid */}
        <div style={{ display:'grid', gridTemplateColumns:'1.1fr 1fr 1fr', gap:32, marginTop:32 }}>
          {/* Rubric card */}
          <Card title="Rubric breakdown" kicker="Averaged · 264 calls">
            <RubricRack rubric={RUBRIC}/>
            <div style={{ marginTop:20, fontSize:12, color:'var(--muted)', lineHeight:1.55 }}>
              Resolution running <span style={{ color:'var(--warn)' }}>-0.4</span> vs. 7-day avg. Two escalations still open past SLA.
            </div>
          </Card>

          {/* Exemplar card */}
          <Card title="Exemplar call" kicker="★ Share in coaching">
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
              <Avatar initials="AR" size={40}/>
              <div>
                <div style={{ fontWeight:500, fontSize:14 }}>Alex Rivera</div>
                <div style={{ fontSize:11, color:'var(--muted)', fontFamily:'var(--mono)', textTransform:'uppercase', letterSpacing:'0.08em' }}>CPAP · 6:40 · 11:02</div>
              </div>
              <div style={{ marginLeft:'auto' }}>
                <ScoreDial value={9.8} size={60} label=""/>
              </div>
            </div>
            <div style={{ fontSize:13, color:'var(--ink)', lineHeight:1.55, padding:'12px 0', borderTop:'1px dashed var(--line)' }}>
              “I'll call <span style={{ background:'var(--accent-soft)', padding:'0 3px' }}>them right now while you're on the line</span>. Do you mind if I put you on a brief hold?”
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:6, fontFamily:'var(--mono)' }}>
              + Proactive ownership · + Empathy-first · + Committed to follow-up
            </div>
          </Card>

          {/* Attention */}
          <Card title="Needs review" kicker={`${FLAGGED.length} flagged`}>
            {FLAGGED.map((f,i) => (
              <div key={f.id} style={{ padding:'11px 0', borderBottom: i<FLAGGED.length-1 ? '1px dashed var(--line)' : 'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <div style={{ fontSize:13, fontWeight:500 }}>{f.who}</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--warn)' }}>{f.score.toFixed(1)}</div>
                </div>
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>{f.reason}</div>
              </div>
            ))}
          </Card>
        </div>

        {/* Agents row */}
        <div style={{ marginTop:32 }}>
          <Card title="Agents · today" kicker="6 on shift" pad={0}>
            <div style={{ padding:'0 24px 20px' }}>
              <div style={{ display:'grid', gridTemplateColumns:'24px 1.4fr 1fr 160px 80px 60px', gap:16, alignItems:'center', padding:'12px 0', borderBottom:'1px solid var(--line)', fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--muted)' }}>
                <div>#</div><div>Agent</div><div>Team</div><div>Score</div><div>Calls</div><div>Trend</div>
              </div>
              {TEAM.map((e,i) => (
                <div key={e.id} style={{ display:'grid', gridTemplateColumns:'24px 1.4fr 1fr 160px 80px 60px', gap:16, alignItems:'center', padding:'12px 0', borderBottom: i<TEAM.length-1 ? '1px dashed var(--line)' : 'none' }}>
                  <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>{String(i+1).padStart(2,'0')}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <Avatar initials={e.initials} size={28}/>
                    <div style={{ fontSize:13, fontWeight:500 }}>{e.name}</div>
                  </div>
                  <div style={{ fontSize:12, color:'var(--muted)', fontFamily:'var(--mono)', textTransform:'uppercase', letterSpacing:'0.08em' }}>{e.team}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ background:'var(--paper-2)', height:6, flex:1, overflow:'hidden', border:'1px solid var(--line)' }}>
                      <div style={{ height:'100%', width:`${e.score*10}%`, background: e.score<7?'var(--warn)':e.score>=9?'var(--good)':'var(--accent)' }}/>
                    </div>
                    <div style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:500, width:32, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{e.score.toFixed(1)}</div>
                  </div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--ink)' }}>{e.calls}</div>
                  <div style={{ fontFamily:'var(--mono)', fontSize:11, color: e.trend>=0?'var(--good)':'var(--warn)' }}>{e.trend>=0?'+':''}{e.trend.toFixed(1)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const Card = ({ title, kicker, children, pad=24 }) => (
  <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', borderRadius:2 }}>
    <div style={{ padding: pad === 0 ? '20px 24px 12px' : `${pad}px ${pad}px 12px`, display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
      <div>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)' }}>{kicker}</div>
        <div style={{ fontFamily:'var(--display)', fontSize:18, fontWeight:500, letterSpacing:-0.2, marginTop:2 }}>{title}</div>
      </div>
    </div>
    <div style={{ padding: pad === 0 ? 0 : `4px ${pad}px ${pad}px` }}>
      {children}
    </div>
  </div>
);

const btnPrimary = { background:'var(--ink)', color:'var(--paper)', border:'none', padding:'9px 14px', fontFamily:'var(--ui)', fontSize:12, fontWeight:500, cursor:'pointer', borderRadius:2 };
const btnGhost = { background:'transparent', color:'var(--ink)', border:'1px solid var(--line)', padding:'9px 14px', fontFamily:'var(--ui)', fontSize:12, fontWeight:500, cursor:'pointer', borderRadius:2 };

Object.assign(window, { V2Pulse });
