// Admin-only Simulated Call Generator — two tabs, matches reference/simulated-calls.tsx
// ──────────────────────────────────────────────────────────────

const statusMeta = (s) => {
  if (s === 'ready')      return { label:'Ready',      bg:'oklch(94% 0.05 160)', fg:'var(--good)', border:'oklch(75% 0.07 160)' };
  if (s === 'generating') return { label:'Generating', bg:'var(--accent-soft)',  fg:'var(--accent)', border:'var(--accent)' };
  if (s === 'pending')    return { label:'Queued',     bg:'var(--paper-2)',      fg:'var(--muted)', border:'var(--line)' };
  if (s === 'failed')     return { label:'Failed',     bg:'oklch(95% 0.04 30)',  fg:'var(--warn)', border:'oklch(80% 0.08 30)' };
  return { label:s, bg:'var(--paper-2)', fg:'var(--muted)', border:'var(--line)' };
};

const StatusBadge = ({ status }) => {
  const m = statusMeta(status);
  return <span style={{ fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.12em', padding:'3px 8px', background:m.bg, color:m.fg, border:`1px solid ${m.border}`, borderRadius:2 }}>{m.label}</span>;
};

const CircBadge = ({ id, compact }) => {
  const m = CIRCUMSTANCE_META[id]; if (!m) return null;
  return <span style={{ fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', padding: compact?'2px 6px':'3px 8px', background:'oklch(96% 0.04 45)', color:'oklch(55% 0.15 45)', border:'1px solid oklch(85% 0.08 45)', borderRadius:2 }}>{m.label}</span>;
};

const QualityPill = ({ tier }) => {
  const bg = tier === 'excellent' ? 'var(--good)' : tier === 'poor' ? 'var(--warn)' : 'var(--muted)';
  return <span style={{ fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', padding:'2px 7px', border:`1px solid ${bg}`, color:bg, borderRadius:2 }}>{tier}</span>;
};

// -------- Synthetic isolation banner --------
const IsolationBanner = () => (
  <div style={{
    background:'oklch(97% 0.05 85)',
    border:'1px solid oklch(85% 0.10 85)',
    borderLeft:'3px solid oklch(70% 0.14 85)',
    padding:'12px 18px', fontSize:12, color:'var(--ink)', lineHeight:1.55, textWrap:'pretty',
  }}>
    <strong style={{ fontFamily:'var(--display)' }}>Synthetic isolation:</strong> generated calls never appear in dashboards, reports, leaderboards, coaching, or the AI's learning knowledge base. They exist only under this page. <span style={{color:'var(--muted)'}}>"Send to Analysis" creates a <code style={{fontFamily:'var(--mono)', fontSize:11, background:'var(--paper-2)', padding:'1px 4px'}}>synthetic = TRUE</code> call row.</span>
  </div>
);

// -------- Library tab --------
const LibraryTab = ({ calls, onOpenVariation, onAnalyze, onDelete, playingId, setPlayingId }) => {
  if (calls.length === 0) return (
    <div style={{ padding:'80px 20px', textAlign:'center', color:'var(--muted)' }}>
      <div style={{ fontFamily:'var(--display)', fontSize:15, marginBottom:6 }}>No simulated calls yet</div>
      <div style={{ fontSize:12 }}>Head to "Generate New" to create one.</div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      {calls.map(c => {
        const isPlaying = playingId === c.id;
        const circs = c.config?.circumstances || [];
        return (
          <div key={c.id} style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'14px 16px' }}>
            <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
              <div style={{flex:1, minWidth:0}}>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:6 }}>
                  <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, color:'var(--ink)' }}>{c.title}</div>
                  <StatusBadge status={c.status}/>
                  {c.qualityTier && <QualityPill tier={c.qualityTier}/>}
                  {circs.map(circ => <CircBadge key={circ} id={circ} compact/>)}
                  {c.sentToAnalysisCallId && (
                    <span style={{ fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--good)', display:'inline-flex', gap:4, alignItems:'center' }}>
                      ✓ Analyzed
                    </span>
                  )}
                </div>
                {c.scenario && <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.5, textWrap:'pretty' }}>{c.scenario}</div>}
                <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', marginTop:8, display:'flex', gap:14, flexWrap:'wrap' }}>
                  {c.durationSeconds != null && <span>{c.durationSeconds}s</span>}
                  {c.turns && <span>{c.turns} turns</span>}
                  {c.ttsCharCount != null && <span>{c.ttsCharCount.toLocaleString()} chars</span>}
                  {c.estimatedCost != null && <span>~${c.estimatedCost.toFixed(4)}</span>}
                  <span>{new Date(c.createdAt).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
                </div>
                {c.error && (
                  <div style={{ marginTop:8, padding:'8px 10px', background:'oklch(96% 0.03 30)', border:'1px solid oklch(85% 0.06 30)', fontSize:11, color:'var(--warn)', display:'flex', gap:6 }}>
                    ⚠ {c.error}
                  </div>
                )}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                {c.status === 'ready' && (
                  <>
                    <button className="icon-btn" onClick={() => setPlayingId(isPlaying ? null : c.id)}>▶ {isPlaying ? 'Hide' : 'Play'}</button>
                    {!c.sentToAnalysisCallId && <button className="icon-btn" onClick={() => onAnalyze(c)}>↳ Analyze</button>}
                    <button className="icon-btn" onClick={() => onOpenVariation(c)} style={{ borderColor:'oklch(70% 0.15 300)', color:'oklch(50% 0.18 300)' }}>✦ Variation</button>
                  </>
                )}
                <button className="icon-btn" onClick={() => onDelete(c)} style={{ color:'var(--warn)' }}>Delete</button>
              </div>
            </div>
            {isPlaying && c.status === 'ready' && (
              <div style={{ marginTop:10, padding:'10px 14px', background:'var(--paper-2)', display:'flex', alignItems:'center', gap:12 }}>
                <FakeAudioPlayer duration={c.durationSeconds}/>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const FakeAudioPlayer = ({ duration }) => {
  const [playing, setPlaying] = React.useState(true);
  const [pos, setPos] = React.useState(0);
  React.useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => setPos(p => (p+1) % duration), 1000);
    return () => clearInterval(iv);
  }, [playing, duration]);
  const fmt = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  // Generate a fake waveform
  const bars = Array.from({length:60}, (_,i) => 0.3 + 0.7 * Math.abs(Math.sin(i*0.8) * Math.cos(i*0.3)));
  return (
    <>
      <button onClick={() => setPlaying(!playing)} style={{ background:'var(--ink)', color:'var(--paper)', border:'none', width:32, height:32, borderRadius:'50%', cursor:'pointer', fontFamily:'var(--mono)' }}>{playing ? '❚❚' : '▶'}</button>
      <div style={{ flex:1, display:'flex', alignItems:'center', gap:1, height:28 }}>
        {bars.map((h, i) => {
          const active = i/bars.length < pos/duration;
          return <div key={i} style={{ width:3, height:`${h*100}%`, background: active ? 'var(--accent)' : 'var(--line)', borderRadius:1 }}/>;
        })}
      </div>
      <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)', fontVariantNumeric:'tabular-nums' }}>{fmt(pos)} / {fmt(duration)}</div>
    </>
  );
};

// -------- Generate tab --------
const GenerateTab = ({ onQueued }) => {
  const [jsonMode, setJsonMode] = React.useState(false);
  const [jsonText, setJsonText] = React.useState('');
  const [script, setScript] = React.useState({ ...EMPTY_SCRIPT,
    title:'CPAP status check — anxious senior',
    scenario:'Margaret, 74. First CPAP, calling about fit. Needs a warm, unhurried opener.',
    turns:[
      { speaker:'agent',    text:'Thank you for calling Acme Respiratory, this is Alex. How can I help you today?' },
      { speaker:'customer', text:'Hello dear, I got my breathing machine in the mail yesterday and I... I\'m not sure I\'m putting it on right.' },
      { speaker:'agent',    text:'Oh absolutely, no rush at all — we\'ll walk through it together. Can I get your date of birth just to pull up your account?' },
    ],
  });
  const [config, setConfig] = React.useState({
    gapDistribution:'natural', gapMeanSeconds:0.8,
    connectionQuality:'phone', backgroundNoise:'none', backgroundNoiseLevel:0.15,
    disfluencies:true, backchannels:true, analyzeAfterGeneration:false,
    circumstances:[],
  });
  const [genScenarioOpen, setGenScenarioOpen] = React.useState(false);

  const totalChars = script.turns.reduce((sum, t) => {
    if (t.speaker === 'hold') return sum;
    return sum + (t.text?.length || 0);
  }, 0);
  const estCost = (totalChars * 0.0003).toFixed(4);
  const capFull = DAILY_USED >= DAILY_CAP;

  const update = (patch) => setScript({ ...script, ...patch });
  const setTurn = (i, turn) => { const turns = [...script.turns]; turns[i] = turn; update({ turns }); };
  const removeTurn = (i) => update({ turns: script.turns.filter((_,idx) => idx !== i) });
  const addTurn = (speaker) => {
    const newTurn = speaker === 'hold' ? { speaker:'hold', duration:5 } : { speaker, text:'' };
    update({ turns: [...script.turns, newTurn] });
  };

  const toggleCirc = (c) => {
    const next = config.circumstances.includes(c) ? config.circumstances.filter(x=>x!==c) : [...config.circumstances, c];
    setConfig({ ...config, circumstances: next });
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:20 }}>
      {/* Left: Script builder */}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)' }}>
          <div style={{ display:'flex', alignItems:'center', padding:'14px 18px', borderBottom:'1px solid var(--line)' }}>
            <div>
              <div style={{ fontFamily:'var(--display)', fontSize:15, fontWeight:500 }}>Script</div>
              <div style={{ fontSize:12, color:'var(--muted)' }}>Build turn-by-turn, or paste existing JSON.</div>
            </div>
            <div style={{flex:1}}/>
            <button className="icon-btn" onClick={() => setJsonMode(!jsonMode)}>{jsonMode ? 'Form mode' : 'JSON mode'}</button>
          </div>
          <div style={{ padding:'16px 18px' }}>
            {jsonMode ? (
              <textarea value={jsonText} onChange={e=>setJsonText(e.target.value)} rows={20} placeholder={JSON.stringify(EMPTY_SCRIPT,null,2)}
                style={{ width:'100%', fontFamily:'var(--mono)', fontSize:11, padding:10, border:'1px solid var(--line)', background:'var(--paper-2)', color:'var(--ink)', resize:'vertical' }}/>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10 }}>
                  <Field label="Title"><input type="text" value={script.title} onChange={e=>update({title:e.target.value})} style={{width:'100%'}}/></Field>
                  <Field label="Quality tier">
                    <select className="select" style={{width:'100%'}} value={script.qualityTier} onChange={e=>update({qualityTier:e.target.value})}>
                      <option value="excellent">Excellent</option><option value="acceptable">Acceptable</option><option value="poor">Poor</option>
                    </select>
                  </Field>
                </div>
                <Field label="Scenario">
                  <textarea value={script.scenario} onChange={e=>update({scenario:e.target.value})} rows={2} style={{width:'100%', fontFamily:'var(--ui)', fontSize:13, padding:'7px 10px', border:'1px solid var(--line)', background:'var(--paper-card)', color:'var(--ink)', resize:'vertical'}}/>
                </Field>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <Field label="Agent voice"><VoicePickerBtn value={script.voices.agent} onChange={v=>update({voices:{...script.voices, agent:v}})}/></Field>
                  <Field label="Customer voice"><VoicePickerBtn value={script.voices.customer} onChange={v=>update({voices:{...script.voices, customer:v}})}/></Field>
                </div>

                {/* Scenario AI generator */}
                <div style={{ background:'oklch(96% 0.04 300)', border:'1px solid oklch(82% 0.08 300)', borderLeft:'3px solid oklch(58% 0.18 300)', padding:'12px 14px', display:'flex', alignItems:'center', gap:14 }}>
                  <div style={{flex:1}}>
                    <div style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:500, color:'oklch(40% 0.16 300)', display:'flex', alignItems:'center', gap:6 }}>✦ Generate turns from title + scenario</div>
                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:3, textWrap:'pretty' }}>Let AI write dialogue from your title + scenario. Haiku by default (~$0.003); Sonnet for richer dialogue (~$0.034).</div>
                  </div>
                  <button className="icon-btn" onClick={() => setGenScenarioOpen(true)} style={{ borderColor:'oklch(60% 0.18 300)', color:'oklch(45% 0.18 300)' }}>✦ Generate</button>
                </div>

                {/* Turns */}
                <div>
                  <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
                    <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em' }}>Turns ({script.turns.length})</div>
                    <div style={{flex:1}}/>
                    <div style={{ display:'flex', gap:6 }}>
                      <button className="icon-btn" onClick={()=>addTurn('agent')}>+ Agent</button>
                      <button className="icon-btn" onClick={()=>addTurn('customer')}>+ Customer</button>
                      <button className="icon-btn" onClick={()=>addTurn('hold')}>+ Hold</button>
                    </div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {script.turns.map((t, i) => <TurnRow key={i} turn={t} onChange={next=>setTurn(i,next)} onRemove={()=>removeTurn(i)}/>)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Config + summary */}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <Panel title="Audio quality">
          <Field label="Connection">
            <select className="select" style={{width:'100%'}} value={config.connectionQuality} onChange={e=>setConfig({...config, connectionQuality:e.target.value})}>
              <option value="clean">Clean (studio)</option><option value="phone">Phone</option>
              <option value="degraded">Degraded</option><option value="poor">Poor connection</option>
            </select>
          </Field>
          <Field label="Background noise">
            <select className="select" style={{width:'100%'}} value={config.backgroundNoise} onChange={e=>setConfig({...config, backgroundNoise:e.target.value})}>
              <option value="none">None</option><option value="office">Office</option>
              <option value="callcenter">Call center</option><option value="static">Static</option>
            </select>
          </Field>
          {config.backgroundNoise !== 'none' && (
            <Field label={`Noise level: ${Math.round(config.backgroundNoiseLevel*100)}%`}>
              <input type="range" min="0" max="1" step="0.05" value={config.backgroundNoiseLevel} onChange={e=>setConfig({...config, backgroundNoiseLevel:parseFloat(e.target.value)})} style={{width:'100%'}}/>
            </Field>
          )}
          <Field label="Turn gap">
            <select className="select" style={{width:'100%'}} value={config.gapDistribution} onChange={e=>setConfig({...config, gapDistribution:e.target.value})}>
              <option value="natural">Natural (randomized)</option><option value="fixed">Fixed</option>
            </select>
          </Field>
          <Field label={`Mean gap: ${config.gapMeanSeconds.toFixed(2)}s`}>
            <input type="range" min="0" max="3" step="0.1" value={config.gapMeanSeconds} onChange={e=>setConfig({...config, gapMeanSeconds:parseFloat(e.target.value)})} style={{width:'100%'}}/>
          </Field>

          <Toggle label="Filler words (um/uh)" sub="Rate scales with quality tier" checked={config.disfluencies} onChange={v=>setConfig({...config, disfluencies:v})}/>
          <Toggle label="Backchannel overlays" sub='"mm-hmm", "okay" under long turns' checked={config.backchannels} onChange={v=>setConfig({...config, backchannels:v})}/>
          <Toggle label="Auto-analyze when ready" sub="Sends through real analysis pipeline (adds Bedrock + AssemblyAI cost)" checked={config.analyzeAfterGeneration} onChange={v=>setConfig({...config, analyzeAfterGeneration:v})}/>
        </Panel>

        <Panel title="Circumstances" subtitle="Apply at generation time. Rule-based items apply immediately; AI items apply via Variation.">
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {CIRCUMSTANCE_VALUES.map(c => {
              const meta = CIRCUMSTANCE_META[c];
              const active = config.circumstances.includes(c);
              return (
                <button key={c} onClick={()=>toggleCirc(c)} style={{
                  textAlign:'left', padding:'8px 10px', border: active ? '1px solid var(--accent)' : '1px solid var(--line)',
                  background: active ? 'var(--accent-soft)' : 'var(--paper-card)', cursor:'pointer', borderRadius:2,
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ fontFamily:'var(--display)', fontSize:12, fontWeight:500, flex:1 }}>{meta.label}</div>
                    <span style={{ fontFamily:'var(--mono)', fontSize:8, padding:'1px 5px', border:`1px solid ${meta.ruleBased?'var(--line)':'oklch(70% 0.15 300)'}`, color: meta.ruleBased ? 'var(--muted)' : 'oklch(50% 0.18 300)', textTransform:'uppercase', letterSpacing:'0.1em', borderRadius:2 }}>{meta.ruleBased ? 'Rule' : 'AI'}</span>
                    {active && <span style={{ color:'var(--good)' }}>✓</span>}
                  </div>
                  <div style={{ fontSize:10, color:'var(--muted)', marginTop:2, lineHeight:1.4, textWrap:'pretty' }}>{meta.description}</div>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Summary">
          <SummaryRow label="Turns" value={script.turns.length}/>
          <SummaryRow label="TTS chars" value={totalChars.toLocaleString()}/>
          <SummaryRow label="Est. cost" value={'$'+estCost}/>
          {config.circumstances.length > 0 && <SummaryRow label="Circumstances" value={config.circumstances.length}/>}
          <button className="icon-btn primary" disabled={capFull} onClick={onQueued} style={{ width:'100%', padding:'10px', marginTop:8 }}>
            {capFull ? 'Daily cap reached' : 'Generate'}
          </button>
        </Panel>
      </div>
    </div>
  );
};

// -------- Small bits --------
const Field = ({ label, children }) => (
  <div>
    <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:5 }}>{label}</div>
    {children}
  </div>
);

const Panel = ({ title, subtitle, children }) => (
  <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)' }}>
    <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--line)' }}>
      <div style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:500 }}>{title}</div>
      {subtitle && <div style={{ fontSize:11, color:'var(--muted)', marginTop:3, lineHeight:1.4, textWrap:'pretty' }}>{subtitle}</div>}
    </div>
    <div style={{ padding:'14px 16px', display:'flex', flexDirection:'column', gap:12 }}>{children}</div>
  </div>
);

const Toggle = ({ label, sub, checked, onChange }) => (
  <div style={{ display:'flex', alignItems:'flex-start', gap:10, paddingTop:8, borderTop:'1px solid var(--line)' }}>
    <div style={{flex:1}}>
      <div style={{ fontSize:12, color:'var(--ink)' }}>{label}</div>
      {sub && <div style={{ fontSize:10, color:'var(--muted)', marginTop:2, textWrap:'pretty', lineHeight:1.4 }}>{sub}</div>}
    </div>
    <label style={{ position:'relative', display:'inline-block', width:32, height:18, cursor:'pointer', flexShrink:0 }}>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{ opacity:0, width:0, height:0 }}/>
      <span style={{ position:'absolute', inset:0, background: checked ? 'var(--accent)' : 'var(--line)', borderRadius:9, transition:'.2s' }}/>
      <span style={{ position:'absolute', top:2, left: checked ? 16 : 2, width:14, height:14, background:'white', borderRadius:'50%', transition:'.2s' }}/>
    </label>
  </div>
);

const SummaryRow = ({ label, value }) => (
  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
    <span style={{ color:'var(--muted)' }}>{label}</span>
    <span style={{ fontFamily:'var(--mono)', fontVariantNumeric:'tabular-nums', color:'var(--ink)' }}>{value}</span>
  </div>
);

const TurnRow = ({ turn, onChange, onRemove }) => {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const speakerColor = turn.speaker === 'agent' ? 'var(--accent)' : turn.speaker === 'customer' ? 'var(--good)' : 'var(--muted)';
  return (
    <div>
      <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
        <span style={{ fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', padding:'4px 8px', border:`1px solid ${speakerColor}`, color:speakerColor, borderRadius:2, marginTop:4, minWidth:70, textAlign:'center' }}>{turn.speaker}</span>
        {turn.speaker === 'hold' ? (
          <input type="number" value={turn.duration} onChange={e=>onChange({ speaker:'hold', duration:parseInt(e.target.value)||1 })} style={{width:80}}/>
        ) : (
          <textarea value={turn.text} onChange={e=>onChange({...turn, text:e.target.value})} rows={2} style={{flex:1, fontFamily:'var(--ui)', fontSize:13, padding:'7px 10px', border:'1px solid var(--line)', background:'var(--paper-card)', color:'var(--ink)', resize:'vertical'}}/>
        )}
        {turn.speaker !== 'hold' && <button className="icon-btn" onClick={()=>setSettingsOpen(!settingsOpen)} title="Voice settings">⚙</button>}
        <button className="icon-btn" onClick={onRemove} style={{color:'var(--warn)'}}>×</button>
      </div>
      {settingsOpen && turn.speaker !== 'hold' && (
        <div style={{ marginLeft:78, marginTop:6, padding:'10px 12px', background:'var(--paper-2)', display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Stability: {(turn.voiceSettings?.stability ?? 0.5).toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.05" defaultValue={turn.voiceSettings?.stability ?? 0.5} style={{width:'100%'}}/>
            <div style={{ fontSize:10, color:'var(--muted)' }}>Lower = more expressive. Higher = more consistent.</div>
          </div>
          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Similarity boost: {(turn.voiceSettings?.similarityBoost ?? 0.75).toFixed(2)}</div>
            <input type="range" min="0" max="1" step="0.05" defaultValue={turn.voiceSettings?.similarityBoost ?? 0.75} style={{width:'100%'}}/>
            <div style={{ fontSize:10, color:'var(--muted)' }}>How closely this turn adheres to the reference voice.</div>
          </div>
        </div>
      )}
    </div>
  );
};

// -------- Voice picker --------
const VoicePickerBtn = ({ value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [gender, setGender] = React.useState('all');
  const [playing, setPlaying] = React.useState(null);
  const selected = VOICES.find(v => v.voice_id === value);
  const filtered = VOICES.filter(v => {
    if (gender !== 'all' && v.labels?.gender !== gender) return false;
    if (query && !(v.name + ' ' + (v.labels?.accent||'') + ' ' + (v.labels?.description||'')).toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  return (
    <div style={{ position:'relative' }}>
      <button onClick={() => setOpen(!open)} style={{ width:'100%', textAlign:'left', padding:'7px 10px', border:'1px solid var(--line)', background:'var(--paper-card)', borderRadius:2, cursor:'pointer', fontFamily:'var(--ui)', fontSize:13, display:'flex', alignItems:'center', justifyContent:'space-between', color:'var(--ink)' }}>
        <span style={{overflow:'hidden', textOverflow:'ellipsis'}}>
          {selected?.name || 'Select voice'}
          {selected?.labels?.accent && <span style={{color:'var(--muted)', marginLeft:6, fontSize:11}}>— {selected.labels.accent}</span>}
        </span>
        <span style={{color:'var(--muted)'}}>▾</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, width:360, background:'var(--paper-card)', border:'1px solid var(--line)', boxShadow:'0 8px 32px rgba(0,0,0,.12)', zIndex:50 }}>
          <div style={{ padding:10, borderBottom:'1px solid var(--line)' }}>
            <input type="text" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name, accent…" style={{width:'100%', marginBottom:8}}/>
            <div style={{ display:'flex', gap:4 }}>
              {['all','female','male'].map(g => (
                <button key={g} onClick={()=>setGender(g)} style={{ flex:1, padding:'4px 6px', border:'1px solid var(--line)', background: gender===g ? 'var(--ink)' : 'var(--paper-card)', color: gender===g ? 'var(--paper)' : 'var(--muted)', fontFamily:'var(--mono)', fontSize:9, textTransform:'uppercase', letterSpacing:'0.1em', cursor:'pointer', borderRadius:2 }}>{g}</button>
              ))}
            </div>
          </div>
          <div style={{ maxHeight:260, overflowY:'auto', padding:4 }}>
            {filtered.map(v => {
              const isSel = v.voice_id === value;
              const isPlaying = playing === v.voice_id;
              const meta = [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description].filter(Boolean).join(' · ');
              return (
                <div key={v.voice_id} onClick={()=>{onChange(v.voice_id); setOpen(false);}} style={{ padding:'8px 10px', display:'flex', gap:8, alignItems:'center', cursor:'pointer', background: isSel ? 'var(--paper-2)' : 'transparent', borderRadius:2 }}>
                  <button onClick={e=>{e.stopPropagation(); setPlaying(isPlaying?null:v.voice_id);}} style={{ width:26, height:26, borderRadius:'50%', border:'1px solid var(--line)', background:'var(--paper-card)', cursor:'pointer', fontSize:9, color:'var(--ink)' }}>{isPlaying ? '❚❚' : '▶'}</button>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{ fontFamily:'var(--display)', fontSize:12, fontWeight:500, display:'flex', gap:6, alignItems:'center' }}>{v.name} {isSel && <span style={{color:'var(--good)'}}>✓</span>}</div>
                    <div style={{ fontSize:10, color:'var(--muted)', textTransform:'lowercase' }}>{meta}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding:'6px 10px', borderTop:'1px solid var(--line)', fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)' }}>{filtered.length} of {VOICES.length} voices</div>
        </div>
      )}
    </div>
  );
};

// -------- Root admin view --------
const SimulatorAdmin = () => {
  const [tab, setTab] = React.useState('library');
  const [calls, setCalls] = React.useState(SIMULATED_CALLS);
  const [playingId, setPlayingId] = React.useState(null);
  const [variationFor, setVariationFor] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };
  const capFull = DAILY_USED >= DAILY_CAP;

  return (
    <div style={{ maxWidth:1240, margin:'0 auto', padding:'24px 40px 40px' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', marginBottom:18, gap:20 }}>
        <div style={{flex:1}}>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:6 }}>Admin · internal tools</div>
          <h1 style={{ fontFamily:'var(--display)', fontSize:26, fontWeight:500, letterSpacing:-0.4, margin:0, color:'var(--ink)', display:'flex', gap:10, alignItems:'center' }}>
            <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="9" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M11 13 V18 M7 18 H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Simulated Call Generator
          </h1>
          <div style={{ fontSize:13, color:'var(--muted)', marginTop:4, textWrap:'pretty', maxWidth:680 }}>Generate synthetic call recordings for QA, agent training, and pipeline regression testing.</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:3 }}>Daily cap</div>
          <div style={{ fontFamily:'var(--display)', fontSize:22, fontWeight:500, color: capFull ? 'var(--warn)' : 'var(--ink)', letterSpacing:-0.5, fontVariantNumeric:'tabular-nums' }}>
            {DAILY_USED}<span style={{color:'var(--muted)', fontWeight:400}}> / {DAILY_CAP}</span>
          </div>
          <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)' }}>today</div>
        </div>
      </div>

      <div style={{ marginBottom:18 }}><IsolationBanner/></div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--line)', marginBottom:22 }}>
        {[
          { id:'library', label:`Library (${calls.length})` },
          { id:'generate', label:'Generate new' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background:'transparent', border:'none', padding:'10px 18px', cursor:'pointer',
            fontFamily:'var(--display)', fontSize:13, fontWeight: tab===t.id ? 600 : 500,
            color: tab===t.id ? 'var(--ink)' : 'var(--muted)',
            borderBottom: tab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom:-1,
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'library' && (
        <LibraryTab calls={calls} playingId={playingId} setPlayingId={setPlayingId}
          onOpenVariation={(c) => setVariationFor(c)}
          onAnalyze={(c) => { setCalls(calls.map(x => x.id === c.id ? { ...x, sentToAnalysisCallId: 'call-'+Math.floor(Math.random()*9999) } : x)); showToast(`Sent "${c.title}" to analysis pipeline.`); }}
          onDelete={(c) => { if (confirm(`Delete "${c.title}"?`)) { setCalls(calls.filter(x => x.id !== c.id)); showToast('Deleted.'); } }}
        />
      )}
      {tab === 'generate' && <GenerateTab onQueued={() => { showToast('Generation queued. Will appear in Library shortly.'); setTab('library'); }}/>}

      {variationFor && <VariationDialog source={variationFor} onClose={() => setVariationFor(null)} onQueued={() => { showToast('Variation queued.'); setVariationFor(null); }}/>}

      {toast && (
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'var(--ink)', color:'var(--paper)', padding:'10px 18px', fontSize:12, borderRadius:3, boxShadow:'0 8px 24px rgba(0,0,0,.15)', zIndex:200 }}>{toast}</div>
      )}
    </div>
  );
};

// -------- Variation dialog --------
const VariationDialog = ({ source, onClose, onQueued }) => {
  const [circumstances, setCircumstances] = React.useState([]);
  const [targetTier, setTargetTier] = React.useState('inherit');
  const [preview, setPreview] = React.useState(null);

  const toggle = (c) => {
    setPreview(null);
    setCircumstances(circumstances.includes(c) ? circumstances.filter(x=>x!==c) : [...circumstances, c]);
  };

  const rewrite = () => {
    // simulate preview
    setPreview({
      title: source.title + ' — variation',
      scenario: source.scenario,
      turns:[
        { speaker:'agent', text:'Thanks for calling back, I see we spoke earlier today — how can I help?' },
        { speaker:'customer', text: circumstances.includes('angry') ? 'Yeah, and I\'m pretty upset honestly. Nothing got resolved.' : 'Hi, following up on the issue we were working through.' },
        { speaker:'agent', text:'I hear you — and I\'m sorry we\'re doing this again. Let me pull up the notes from earlier.' },
        { speaker:'customer', text: circumstances.includes('escalation') ? 'I\'d like to speak to your supervisor, please.' : 'Okay, go ahead.' },
        { speaker:'agent', text:'Absolutely, of course. One moment while I connect you.' },
      ],
    });
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'var(--paper)', border:'1px solid var(--line)', width:640, maxHeight:'90vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,.3)' }}>
        <div style={{ padding:'16px 22px', borderBottom:'1px solid var(--line)' }}>
          <div style={{ fontFamily:'var(--display)', fontSize:16, fontWeight:500, color:'oklch(45% 0.18 300)' }}>✦ Create variation</div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:4, textWrap:'pretty' }}>Pick circumstances; AI rewrites the script. Preview before spending TTS credits. Rewrite cost: ~$0.003 Haiku / ~$0.034 Sonnet.</div>
        </div>
        <div style={{ padding:'18px 22px', overflow:'auto', flex:1 }}>
          {!preview ? (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div>
                <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Source</div>
                <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500 }}>{source.title}</div>
              </div>
              <div>
                <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Circumstances (1–4)</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  {CIRCUMSTANCE_VALUES.map(c => {
                    const active = circumstances.includes(c);
                    return (
                      <button key={c} onClick={() => toggle(c)} style={{ textAlign:'left', padding:'8px 10px', border: active ? '1px solid var(--accent)' : '1px solid var(--line)', background: active ? 'var(--accent-soft)' : 'var(--paper-card)', cursor:'pointer', borderRadius:2, fontSize:12 }}>
                        {CIRCUMSTANCE_META[c].label} {active && <span style={{color:'var(--good)', float:'right'}}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label="Target quality tier">
                <select className="select" value={targetTier} onChange={e=>setTargetTier(e.target.value)} style={{width:'100%'}}>
                  <option value="inherit">Inherit from source ({source.qualityTier})</option>
                  <option value="poor">Poor</option><option value="acceptable">Acceptable</option><option value="excellent">Excellent</option>
                </select>
              </Field>
            </div>
          ) : (
            <div>
              <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Rewritten script</div>
              <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500, marginBottom:12 }}>{preview.title}</div>
              <div style={{ background:'var(--paper-2)', padding:'12px 14px', maxHeight:320, overflowY:'auto', fontSize:12, lineHeight:1.6 }}>
                {preview.turns.map((t,i) => (
                  <div key={i} style={{marginBottom:6}}><span style={{ fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', color:'var(--muted)' }}>{t.speaker}:</span> {t.text}</div>
                ))}
              </div>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', marginTop:10 }}>{preview.turns.length} turns · Generate will queue a new call using this script.</div>
            </div>
          )}
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid var(--line)', display:'flex', justifyContent:'flex-end', gap:8 }}>
          <button className="icon-btn" onClick={preview ? () => setPreview(null) : onClose}>{preview ? 'Back' : 'Cancel'}</button>
          <button className="icon-btn primary" onClick={preview ? onQueued : rewrite} disabled={!preview && (circumstances.length === 0 || circumstances.length > 4)}>
            {preview ? 'Generate variation' : '✦ Preview rewrite'}
          </button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { SimulatorAdmin });
