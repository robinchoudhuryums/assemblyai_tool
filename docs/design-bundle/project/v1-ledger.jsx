// Variant 1: LEDGER — supervisor, dense, newspaper/ops-desk layout

const V1Ledger = () => {
  const today = 'Thu · Apr 18';
  return (
    <div className="variant" style={{ width: 1440, minHeight: 900, background:'var(--paper)', color:'var(--ink)', fontFamily:'var(--ui)', position:'relative' }}>
      {/* Masthead */}
      <div style={{ borderBottom:'2px solid var(--ink)', padding:'22px 44px 18px', display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.24em', color:'var(--muted)' }}>
            Daily Call Ledger · Vol. 14 · No. 104
          </div>
          <div style={{ fontFamily:'var(--display)', fontSize:44, fontWeight:500, letterSpacing:-1.5, marginTop:2, lineHeight:1 }}>
            Operations Desk
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>{today} · 14:02 PT</div>
          <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--ink)', marginTop:2 }}>Supervisor · M. Alvarez</div>
        </div>
      </div>

      {/* Tagline row */}
      <div style={{ display:'flex', gap:32, padding:'10px 44px', borderBottom:'1px solid var(--line)', fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>
        <span><span style={{ color:'var(--ink)', fontWeight:500 }}>264</span> calls today</span>
        <span>CPAP · CGM · Oxygen · PA</span>
        <span>Queue depth <span style={{ color:'var(--ink)' }}>7</span></span>
        <span>Avg wait <span style={{ color:'var(--ink)' }}>1:12</span></span>
        <span style={{ marginLeft:'auto' }}>Last sync <span style={{ color:'var(--ink)' }}>14:01:48</span></span>
      </div>

      <div style={{ padding:'28px 44px', display:'grid', gridTemplateColumns:'1fr 380px', gap:40 }}>
        {/* LEFT — main content */}
        <div>
          {/* Four stats across */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:32, paddingBottom:24, borderBottom:'1px solid var(--line)' }}>
            <StatBlock label="Calls · 24h" value="264" delta={+12} spark={[18,22,19,28,31,26,44,38,41,36,29,22]} />
            <StatBlock label="Team score" value="8.1" unit="/10" delta={+0.3} spark={[7.6,7.8,7.9,8.0,7.9,8.1,8.0,8.1,8.2,8.1,8.1,8.1]}/>
            <StatBlock label="Sentiment" value="+0.31" delta={-0.08} spark={[0.4,0.45,0.5,0.42,0.38,0.31,0.28,0.32,0.33,0.31]} sparkColor="var(--good)"/>
            <StatBlock label="Flagged" value="3" unit="calls" delta={-2} spark={[5,6,4,5,3,4,3,3,2,3]} sparkColor="var(--warn)"/>
          </div>

          {/* AI Summary — editor's note */}
          <div style={{ padding:'24px 0', borderBottom:'1px solid var(--line)', display:'grid', gridTemplateColumns:'120px 1fr', gap:24 }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)', paddingTop:4 }}>
              AI briefing
              <div style={{ fontSize:9, marginTop:4, color:'var(--muted)' }}>Claude · 14:02</div>
            </div>
            <div>
              <div style={{ fontFamily:'var(--display)', fontSize:20, fontWeight:400, lineHeight:1.4, color:'var(--ink)', letterSpacing:-0.3 }}>
                Volume up 12% driven by CPAP intake. Two Oxygen calls missed HIPAA verification — both Wren H. Billing-dispute de-escalations by <span style={{ background:'var(--accent-soft)', padding:'0 3px' }}>Priya S.</span> are a pattern worth sharing in coaching.
              </div>
              <div style={{ marginTop:14, display:'flex', gap:12, fontFamily:'var(--mono)', fontSize:11 }}>
                <button style={btnLink}>Draft coaching note →</button>
                <button style={btnLink}>Share with team →</button>
                <button style={btnLink}>Regenerate</button>
              </div>
            </div>
          </div>

          {/* Sentiment curve + volume */}
          <div style={{ padding:'24px 0', borderBottom:'1px solid var(--line)' }}>
            <SectionHeader kicker="Today · hourly" title="Sentiment & volume curve"/>
            <SentimentCurve sentiment={SENTIMENT_CURVE} volume={VOLUME} width={820} height={180} accent="var(--accent)"/>
            <div style={{ display:'flex', gap:16, marginTop:8, fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>
              <span>— sentiment (avg)</span>
              <span>▪ volume (calls/hr)</span>
              <span style={{ marginLeft:'auto' }}>Midday dip at 14:00–16:00 — correlated with CGM eligibility calls.</span>
            </div>
          </div>

          {/* Recent calls ledger */}
          <div style={{ padding:'24px 0', borderBottom:'1px solid var(--line)' }}>
            <SectionHeader kicker="Ledger" title="Most recent · 6 calls"/>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--line)' }}>
                  {['Time','Agent','Kind','Topic','Sent.','Score','Dur','Flag'].map(h => (
                    <th key={h} style={{ textAlign:'left', fontFamily:'var(--mono)', fontWeight:400, fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', padding:'8px 8px 8px 0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RECENT_CALLS.map(c => (
                  <tr key={c.id} style={{ borderBottom:'1px dashed var(--line)' }}>
                    <td style={tdMono}>{c.at}</td>
                    <td style={{ ...td, display:'flex', alignItems:'center', gap:8 }}>
                      <Avatar initials={c.who.split(' ').map(w=>w[0]).join('')} size={22}/>
                      <span>{c.who}</span>
                      <span style={{ color:'var(--muted)', fontFamily:'var(--mono)', fontSize:11 }}>{c.ext}</span>
                    </td>
                    <td style={td}><span style={pill}>{c.kind}</span></td>
                    <td style={{ ...td, color:'var(--ink)' }}>{c.topic}</td>
                    <td style={td}><SentimentDot kind={c.sentiment}/></td>
                    <td style={{ ...tdMono, color: c.score<7?'var(--warn)':c.score>=9?'var(--good)':'var(--ink)' }}>{c.score.toFixed(1)}</td>
                    <td style={tdMono}>{c.dur}</td>
                    <td style={td}>
                      {c.flags.includes('exceptional') && <span style={{ ...tag, color:'var(--good)', borderColor:'var(--good)' }}>★ exemplar</span>}
                      {c.flags.includes('no_commit') && <span style={{ ...tag, color:'var(--warn)', borderColor:'var(--warn)' }}>no follow-up</span>}
                      {c.flags.includes('silence') && <span style={{ ...tag, color:'var(--warn)', borderColor:'var(--warn)' }}>silence &gt;22s</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rubric + Team leaderboard */}
          <div style={{ padding:'24px 0', display:'grid', gridTemplateColumns:'1fr 1.2fr', gap:48 }}>
            <div>
              <SectionHeader kicker="Team rubric · today" title="Scoring breakdown"/>
              <RubricRack rubric={RUBRIC}/>
              <div style={{ marginTop:16, fontSize:12, color:'var(--muted)', lineHeight:1.5 }}>
                Resolution down 0.4 vs. 7-day avg. Two unresolved escalations driving the dip.
              </div>
            </div>
            <div>
              <SectionHeader kicker="Agents · today" title="Performance board"/>
              <div>
                {TEAM.map((e,i) => (
                  <div key={e.id} style={{ display:'grid', gridTemplateColumns:'18px 1fr 90px 56px 40px', gap:12, alignItems:'center', padding:'10px 0', borderBottom: i<TEAM.length-1 ? '1px dashed var(--line)' : 'none' }}>
                    <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>{String(i+1).padStart(2,'0')}</div>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <Avatar initials={e.initials} size={24}/>
                      <div>
                        <div style={{ fontSize:13, fontWeight:500 }}>{e.name}</div>
                        <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--mono)', textTransform:'uppercase', letterSpacing:'0.08em' }}>{e.team}</div>
                      </div>
                    </div>
                    <div style={{ background:'var(--paper-2)', height:6, borderRadius:3, overflow:'hidden', border:'1px solid var(--line)' }}>
                      <div style={{ height:'100%', width:`${e.score*10}%`, background: e.score<7?'var(--warn)':e.score>=9?'var(--good)':'var(--accent)' }}/>
                    </div>
                    <div style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:500, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>{e.score.toFixed(1)}</div>
                    <div style={{ fontFamily:'var(--mono)', fontSize:10, textAlign:'right', color: e.trend>=0?'var(--good)':'var(--warn)' }}>{e.trend>=0?'+':''}{e.trend.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT rail */}
        <div style={{ borderLeft:'1px solid var(--line)', paddingLeft:32 }}>
          {/* Needs attention */}
          <SectionHeader kicker="Attention" title="Flagged calls"/>
          {FLAGGED.map(f => (
            <div key={f.id} style={{ padding:'12px 0', borderBottom:'1px dashed var(--line)' }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                <div style={{ fontSize:13, fontWeight:500 }}>{f.who}</div>
                <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--warn)', fontWeight:500 }}>{f.score.toFixed(1)}</div>
              </div>
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:2, lineHeight:1.4 }}>{f.reason}</div>
              <div style={{ display:'flex', gap:10, marginTop:6, fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>
                <span>{f.team}</span><span>·</span><span>{f.dur}</span><span>·</span><span>{f.time}</span>
                <a style={{ marginLeft:'auto', color:'var(--accent)', textDecoration:'none', borderBottom:'1px solid var(--accent)' }}>open ↗</a>
              </div>
            </div>
          ))}

          <div style={{ height:28 }}/>
          <SectionHeader kicker="Exemplars" title="Share in coaching"/>
          {EXCEPTIONAL.map(f => (
            <div key={f.id} style={{ padding:'12px 0', borderBottom:'1px dashed var(--line)' }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                <div style={{ fontSize:13, fontWeight:500 }}>{f.who}</div>
                <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--good)', fontWeight:500 }}>{f.score.toFixed(1)}</div>
              </div>
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:2, lineHeight:1.4 }}>{f.reason}</div>
            </div>
          ))}

          <div style={{ height:28 }}/>
          <SectionHeader kicker="Queue" title="Live"/>
          <div style={{ background:'var(--paper-2)', border:'1px solid var(--line)', padding:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', fontFamily:'var(--mono)' }}>In queue</div>
              <div style={{ fontFamily:'var(--display)', fontSize:22, fontWeight:500 }}>7</div>
            </div>
            {['CPAP status · 0:42','CGM eligibility · 0:28','PA inquiry · 0:19','Oxygen replace · 0:12','Billing · 0:08'].map((l,i) => (
              <div key={i} style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--ink)', padding:'4px 0', borderTop: i===0?'none':'1px dotted var(--line)' }}>{l}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionHeader = ({ kicker, title }) => (
  <div style={{ marginBottom:14 }}>
    <div style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.16em', color:'var(--muted)' }}>{kicker}</div>
    <div style={{ fontFamily:'var(--display)', fontSize:22, fontWeight:500, letterSpacing:-0.3, marginTop:2 }}>{title}</div>
  </div>
);

const btnLink = { background:'transparent', border:'none', borderBottom:'1px solid var(--accent)', color:'var(--accent)', padding:'2px 0', fontFamily:'var(--mono)', fontSize:11, cursor:'pointer' };
const td = { padding:'10px 8px 10px 0', fontSize:13, color:'var(--ink)' };
const tdMono = { ...td, fontFamily:'var(--mono)', fontVariantNumeric:'tabular-nums', fontSize:12 };
const pill = { fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', border:'1px solid var(--line)', padding:'2px 6px', color:'var(--muted)' };
const tag = { fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', border:'1px solid', padding:'2px 6px' };

Object.assign(window, { V1Ledger });
