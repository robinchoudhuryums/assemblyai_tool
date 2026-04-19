// Variant 3: AGENT LENS — agent self-review, airy, coaching-forward with inline transcript highlights

const V3AgentLens = () => {
  return (
    <div className="variant" style={{ width: 1440, minHeight: 900, background:'var(--paper)', color:'var(--ink)', fontFamily:'var(--ui)' }}>
      {/* Topbar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'24px 72px', borderBottom:'1px solid var(--line)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:8, height:8, background:'var(--accent)', borderRadius:'50%' }}/>
          <div style={{ fontFamily:'var(--mono)', fontSize:11, textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--muted)' }}>Your week · Apr 14 – Apr 18</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ fontSize:13, color:'var(--ink)' }}>Alex Rivera</div>
          <Avatar initials="AR" size={32}/>
        </div>
      </div>

      <div style={{ padding:'56px 72px 72px', maxWidth:1200, margin:'0 auto' }}>
        {/* Hero greeting */}
        <div style={{ marginBottom:48 }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:11, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)' }}>Good afternoon, Alex</div>
          <div style={{ fontFamily:'var(--display)', fontSize:56, fontWeight:400, letterSpacing:-1.5, lineHeight:1.05, marginTop:10, maxWidth:900 }}>
            You handled <span style={{ color:'var(--accent)' }}>18 calls</span> this week. Your patients left on a high note — and there's one small moment to work on.
          </div>
        </div>

        {/* Weekly stats — big, airy */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:40, paddingBottom:48, borderBottom:'1px solid var(--line)' }}>
          <BigStat label="Your score" value="9.2" unit="/10" delta={+0.4} note="top 15% of team"/>
          <BigStat label="Calls this week" value="18" delta={+2} note="vs. last week"/>
          <BigStat label="Sentiment" value="+0.58" delta={+0.12} note="mostly positive"/>
          <BigStat label="Avg duration" value="6:24" delta={-0.3} note="−18s" unitNone/>
        </div>

        {/* The exemplar moment */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 360px', gap:48, padding:'48px 0', borderBottom:'1px solid var(--line)' }}>
          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:11, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--good)' }}>★ Your exemplar · CPAP order status · 6:40</div>
            <div style={{ fontFamily:'var(--display)', fontSize:30, fontWeight:500, letterSpacing:-0.5, marginTop:6 }}>This call is going into the coaching library.</div>
            <div style={{ fontSize:15, color:'var(--muted)', marginTop:8, lineHeight:1.5, maxWidth:560 }}>
              A three-week-delayed authorization — exactly the kind of call that usually goes sideways. You stayed with the patient, called the insurer while they held, and closed with a tracking commitment.
            </div>

            {/* Transcript with inline coaching */}
            <div style={{ marginTop:24, background:'var(--paper-card)', border:'1px solid var(--line)', borderRadius:2 }}>
              <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--line)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--muted)' }}>Transcript · first 1:35 of 6:40</div>
                <div style={{ display:'flex', alignItems:'center', gap:8, fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>
                  <Waveform/>
                  <span>▸ Play</span>
                </div>
              </div>
              <div style={{ padding:'16px 24px' }}>
                {TRANSCRIPT.map((l, i) => {
                  if (l.sp === 'hold') return (
                    <div key={i} style={{ textAlign:'center', fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', padding:'8px 0', letterSpacing:'0.1em' }}>
                      {l.text}
                    </div>
                  );
                  const isAgent = l.sp === 'agent';
                  return (
                    <div key={i} style={{ display:'grid', gridTemplateColumns:'44px 60px 1fr', gap:12, padding:'8px 0', alignItems:'start', position:'relative' }}>
                      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', fontVariantNumeric:'tabular-nums', paddingTop:3 }}>{l.t}</div>
                      <div style={{ fontSize:11, color: isAgent ? 'var(--accent)' : 'var(--muted)', fontWeight:500, paddingTop:3, textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:'var(--mono)' }}>{isAgent ? 'You' : l.name}</div>
                      <div>
                        <div style={{ fontSize:14, lineHeight:1.55, color:'var(--ink)' }}>
                          {l.coach ? (
                            <span style={{
                              background: l.coach.kind==='good' ? 'rgba(86,140,110,0.12)' : 'rgba(193,106,66,0.12)',
                              boxShadow: `inset 0 -2px 0 ${l.coach.kind==='good' ? 'var(--good)' : 'var(--warn)'}`,
                              padding:'0 2px'
                            }}>{l.text}</span>
                          ) : l.text}
                        </div>
                        {l.coach && (
                          <div style={{ marginTop:6, display:'flex', gap:10, alignItems:'flex-start' }}>
                            <div style={{
                              fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.1em',
                              color: l.coach.kind==='good' ? 'var(--good)' : 'var(--warn)',
                              border:`1px solid ${l.coach.kind==='good' ? 'var(--good)' : 'var(--warn)'}`,
                              padding:'2px 6px', whiteSpace:'nowrap'
                            }}>{l.coach.kind==='good' ? '+ '+l.coach.label : '○ '+l.coach.label}</div>
                            <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.45, fontStyle:'italic' }}>{l.coach.note}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: score + rubric */}
          <div>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:32 }}>
              <ScoreDial value={9.8} size={180} label="this call"/>
            </div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)', marginBottom:16, textAlign:'center' }}>Rubric</div>
            <RubricRack rubric={{ compliance:10, customerExperience:9.8, communication:9.5, resolution:9.9 }} compact/>

            <div style={{ marginTop:32, padding:18, background:'var(--paper-2)', border:'1px solid var(--line)' }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--muted)', marginBottom:8 }}>One thing to try</div>
              <div style={{ fontSize:13, lineHeight:1.55, color:'var(--ink)' }}>
                Before ending the call, verbally confirm the patient's callback number. It's a HIPAA-recommended close and you missed it at <span style={{ fontFamily:'var(--mono)', color:'var(--accent)' }}>1:29</span>.
              </div>
              <button style={{ marginTop:12, background:'transparent', border:'1px solid var(--ink)', color:'var(--ink)', padding:'7px 12px', fontFamily:'var(--ui)', fontSize:11, fontWeight:500, cursor:'pointer' }}>Practice in simulator →</button>
            </div>
          </div>
        </div>

        {/* Badges + weekly */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:48, padding:'48px 0 0' }}>
          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)' }}>Badges · earned this week</div>
            <div style={{ fontFamily:'var(--display)', fontSize:24, fontWeight:500, letterSpacing:-0.3, marginTop:4, marginBottom:20 }}>Three new.</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:14 }}>
              {[
                { icon:'★', name:'Perfect 10', note:'scored 10.0 on a call' },
                { icon:'◇', name:'Hat Trick', note:'3 in a row above 8' },
                { icon:'♥', name:'Empathy Champion', note:'CX ≥ 9 for 5 calls' },
                { icon:'▲', name:'25 Calls', note:'milestone', faded:true },
                { icon:'✓', name:'Resolution Ace', note:'res ≥ 9 for 5', faded:true },
              ].map(b => (
                <div key={b.name} style={{
                  border:'1px solid var(--line)',
                  padding:'14px 16px',
                  background: b.faded ? 'transparent' : 'var(--paper-card)',
                  opacity: b.faded ? 0.45 : 1,
                  minWidth:180
                }}>
                  <div style={{ fontFamily:'var(--display)', fontSize:24, color: b.faded ? 'var(--muted)' : 'var(--accent)' }}>{b.icon}</div>
                  <div style={{ fontSize:13, fontWeight:500, marginTop:4 }}>{b.name}</div>
                  <div style={{ fontSize:11, color:'var(--muted)', marginTop:2, fontFamily:'var(--mono)' }}>{b.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)' }}>Your week · sentiment</div>
            <div style={{ fontFamily:'var(--display)', fontSize:24, fontWeight:500, letterSpacing:-0.3, marginTop:4, marginBottom:20 }}>Smooth sailing.</div>
            <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'16px 20px' }}>
              <WeekStrip/>
              <div style={{ marginTop:16, fontSize:12, color:'var(--muted)', lineHeight:1.55 }}>
                Your lowest call this week was a <span style={{ color:'var(--ink)' }}>7.4</span> (Tue, 14:20 — CGM eligibility). Worth listening back; you handled a confused caller patiently.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const BigStat = ({ label, value, unit, delta, note, unitNone }) => (
  <div>
    <div style={{ fontSize:11, fontFamily:'var(--mono)', textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--muted)' }}>{label}</div>
    <div style={{ display:'flex', alignItems:'baseline', gap:6, marginTop:10 }}>
      <div style={{ fontFamily:'var(--display)', fontSize:54, fontWeight:500, letterSpacing:-2, lineHeight:1, fontVariantNumeric:'tabular-nums' }}>{value}</div>
      {unit && !unitNone && <div style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--muted)' }}>{unit}</div>}
    </div>
    <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8, fontFamily:'var(--mono)', fontSize:11 }}>
      {delta != null && (
        <span style={{ color: delta>=0 ? 'var(--good)' : 'var(--warn)' }}>{delta>=0?'▲':'▼'} {Math.abs(delta).toFixed(2).replace(/\.?0+$/,'')}</span>
      )}
      <span style={{ color:'var(--muted)' }}>{note}</span>
    </div>
  </div>
);

const Waveform = () => (
  <svg width={90} height={16}>
    {Array.from({length: 24}).map((_,i) => {
      const h = 3 + Math.abs(Math.sin(i*0.9)) * 11;
      return <rect key={i} x={i*3.6} y={(16-h)/2} width={2} height={h} fill="var(--muted)"/>;
    })}
  </svg>
);

const WeekStrip = () => {
  const days = [
    { d:'Mon', vals:[8.8, 9.1, 8.6] },
    { d:'Tue', vals:[9.0, 7.4, 8.9] },
    { d:'Wed', vals:[9.2, 9.5, 9.1, 8.8] },
    { d:'Thu', vals:[9.8, 9.0, 9.2] },
    { d:'Fri', vals:[] },
  ];
  return (
    <div style={{ display:'flex', gap:20, alignItems:'flex-end', height:120 }}>
      {days.map(d => (
        <div key={d.d} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
          <div style={{ display:'flex', gap:3, alignItems:'flex-end', height:90 }}>
            {d.vals.length === 0 ? (
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', paddingBottom:40 }}>—</div>
            ) : d.vals.map((v,i) => (
              <div key={i} style={{ width:8, height: (v/10)*88, background: v<7?'var(--warn)':v>=9?'var(--good)':'var(--accent)' }}/>
            ))}
          </div>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em' }}>{d.d}</div>
        </div>
      ))}
    </div>
  );
};

Object.assign(window, { V3AgentLens });
