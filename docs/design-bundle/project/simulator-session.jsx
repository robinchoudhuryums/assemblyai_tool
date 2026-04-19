// Scenario library + 3 session UI variants + post-session review
// All-in-one for the simulator main screens.

// -------- Scenario Library --------
const ScenarioLibrary = ({ onPickScenario }) => {
  const [filter, setFilter] = React.useState({ difficulty:'all', competency:'all' });
  const assigned = SCENARIOS.filter(s => s.assigned);
  const rest = SCENARIOS.filter(s => !s.assigned);
  const filteredRest = rest.filter(s => {
    if (filter.difficulty !== 'all' && s.difficulty !== filter.difficulty) return false;
    if (filter.competency !== 'all' && s.competency !== filter.competency) return false;
    return true;
  });

  const prog = SIM_PROGRESS.e1;

  return (
    <div style={{ maxWidth:1200, margin:'0 auto', padding:'32px 40px' }}>
      {/* Hero */}
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:24, gap:32 }}>
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8 }}>Rehearsal studio · practice space</div>
          <h1 style={{ fontFamily:'var(--display)', fontSize:32, fontWeight:500, letterSpacing:-0.6, margin:0, color:'var(--ink)', lineHeight:1.15, textWrap:'pretty', maxWidth:620 }}>
            A safe place to practice the hard calls. <span style={{color:'var(--muted)'}}>No one’s watching but you.</span>
          </h1>
        </div>
        <div style={{ display:'flex', gap:18, alignItems:'flex-end' }}>
          <StatMini label="Sessions / week" value={prog.sessionsThisWeek}/>
          <StatMini label="Streak" value={prog.streak}/>
          <StatMini label="Avg score" value={prog.avgScore.toFixed(1)} color="var(--accent)"/>
        </div>
      </div>

      {/* Assigned */}
      {assigned.length > 0 && (
        <div style={{ marginBottom:32 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
            <h3 style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:600, margin:0, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.14em' }}>Assigned to you</h3>
            <div style={{ flex:1, height:1, background:'var(--line)' }}/>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(380px, 1fr))', gap:14 }}>
            {assigned.map(s => <ScenarioCard key={s.id} scenario={s} onPick={onPickScenario} assigned/>)}
          </div>
        </div>
      )}

      {/* Library */}
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <h3 style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:600, margin:0, color:'var(--ink)', textTransform:'uppercase', letterSpacing:'0.14em' }}>Library</h3>
          <div style={{ flex:1, height:1, background:'var(--line)' }}/>
          <select className="select" value={filter.difficulty} onChange={e=>setFilter({...filter, difficulty:e.target.value})}>
            <option value="all">All difficulties</option>
            {SCENARIO_DIFFICULTY.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <select className="select" value={filter.competency} onChange={e=>setFilter({...filter, competency:e.target.value})}>
            <option value="all">All competencies</option>
            {COMPETENCIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(380px, 1fr))', gap:14 }}>
          {filteredRest.map(s => <ScenarioCard key={s.id} scenario={s} onPick={onPickScenario}/>)}
        </div>
      </div>
    </div>
  );
};

const StatMini = ({ label, value, color='var(--ink)' }) => (
  <div style={{ textAlign:'right' }}>
    <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:2 }}>{label}</div>
    <div style={{ fontFamily:'var(--display)', fontSize:24, fontWeight:500, color, letterSpacing:-0.5, fontVariantNumeric:'tabular-nums' }}>{value}</div>
  </div>
);

const ScenarioCard = ({ scenario, onPick, assigned }) => {
  const persona = PERSONAS[scenario.persona];
  return (
    <div
      onClick={() => onPick(scenario)}
      style={{
        background:'var(--paper-card)', border:'1px solid var(--line)',
        borderLeft: assigned ? '3px solid var(--accent)' : '1px solid var(--line)',
        padding:'18px 20px', cursor:'pointer',
        display:'flex', flexDirection:'column', gap:12,
        transition:'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background='var(--paper-2)'}
      onMouseLeave={e => e.currentTarget.style.background='var(--paper-card)'}
    >
      <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
        <PatientAvatar persona={persona} size={52}/>
        <div style={{flex:1, minWidth:0}}>
          <div style={{ fontFamily:'var(--display)', fontSize:15, fontWeight:500, color:'var(--ink)', letterSpacing:-0.1, marginBottom:4 }}>{scenario.title}</div>
          <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.5, textWrap:'pretty' }}>{scenario.summary}</div>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8, paddingTop:8, borderTop:'1px solid var(--line)' }}>
        <DifficultyChip id={scenario.difficulty}/>
        <CompetencyChip id={scenario.competency} compact/>
        <div style={{flex:1}}/>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>{scenario.duration}</div>
      </div>
      {assigned && scenario.assignedBy && (
        <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.12em' }}>✦ {scenario.assignedBy}</div>
      )}
    </div>
  );
};

// -------- Session state hook (shared) --------
const useSession = (scenario) => {
  const [beatIdx, setBeatIdx] = React.useState(0);
  const [history, setHistory] = React.useState([]); // [{who, line, t, mood, scoreKind, note}]
  const [rubric, setRubric] = React.useState({ empathy:0, compliance:0, discovery:0, product:0, close:0, pace:0 });
  const [moodSeries, setMoodSeries] = React.useState([scenario.beats[0]?.mood ?? 0]);
  const [revealed, setRevealed] = React.useState(false);
  const [pickedId, setPickedId] = React.useState(null);

  // Auto-play first patient beat into history
  React.useEffect(() => {
    if (history.length === 0 && scenario.beats[0]?.who === 'patient') {
      setHistory([{ ...scenario.beats[0], idx:0 }]);
    }
  }, []);

  const currentBeat = scenario.beats[beatIdx];
  const nextBeat = scenario.beats[beatIdx+1];

  const pickOption = (option) => {
    setRevealed(true); setPickedId(option.id);
    // bump rubric
    const next = { ...rubric };
    (option.rubricHit || []).forEach(r => { next[r] = Math.min((next[r] || 0) + 1.4, 10); });
    (option.rubricMiss || []).forEach(r => { next[r] = Math.max((next[r] || 0) - 0.8, 0); });
    // small "ok" bumps
    if (option.score === 'neutral') {
      Object.keys(next).forEach(k => { next[k] = Math.min((next[k] || 0) + 0.3, 10); });
    } else if (option.score === 'exemplar') {
      Object.keys(next).forEach(k => { next[k] = Math.min((next[k] || 0) + 0.6, 10); });
    }
    setRubric(next);
    // push agent line into history
    setHistory(h => [...h, { who:'agent', line:option.text, t:currentBeat.t, scoreKind:option.score, note:option.note }]);
  };

  const advance = () => {
    setRevealed(false); setPickedId(null);
    const newIdx = beatIdx + 2; // skip the patient beat we're about to show
    const nextPatientBeat = scenario.beats[beatIdx+1];
    if (nextPatientBeat) {
      setHistory(h => [...h, nextPatientBeat]);
      setMoodSeries(m => [...m, nextPatientBeat.mood ?? m[m.length-1]]);
    }
    setBeatIdx(newIdx);
  };

  return { history, rubric, moodSeries, currentBeat, nextBeat, revealed, pickedId, pickOption, advance, done: beatIdx >= scenario.beats.length };
};

// -------- Variant A: Chat --------
const ChatSession = ({ scenario, onExit, onFinish, coachOn }) => {
  const persona = PERSONAS[scenario.persona];
  const s = useSession(scenario);
  const scrollRef = React.useRef(null);
  React.useEffect(() => { scrollRef.current?.scrollTo({ top: 99999, behavior:'smooth' }); }, [s.history.length, s.revealed]);

  // Is the currently-visible beat the one with the prompt?
  const promptBeat = scenario.beats[s.currentBeat?.who === 'agent' ? scenario.beats.indexOf(s.currentBeat) : scenario.beats.indexOf(s.currentBeat)+1];
  const activePrompt = scenario.beats.find((b,i) => b.who==='agent' && i === (s.history.length-1) + (s.history[s.history.length-1]?.who==='patient'?1:0));

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', height:'calc(100vh - 52px)' }}>
      {/* Chat */}
      <div style={{ display:'flex', flexDirection:'column', borderRight:'1px solid var(--line)' }}>
        <div style={{ padding:'14px 24px', borderBottom:'1px solid var(--line)', display:'flex', gap:12, alignItems:'center', background:'var(--paper-card)' }}>
          <PatientAvatar persona={persona} size={36} mood={s.moodSeries[s.moodSeries.length-1]} speaking={false}/>
          <div>
            <div style={{ fontFamily:'var(--display)', fontSize:14, fontWeight:500 }}>{persona.name}</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>{scenario.title}</div>
          </div>
          <div style={{flex:1}}/>
          <button className="icon-btn" onClick={onExit}>End session</button>
        </div>
        <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'24px 40px', background:'var(--paper)' }}>
          {s.history.map((msg, i) => (
            <TranscriptBubble key={i} who={msg.who} line={msg.line} t={msg.t}/>
          ))}
          {activePrompt && !s.revealed && (
            <div style={{ marginTop:18 }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:10 }}>↳ Your turn — {activePrompt.prompt}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {activePrompt.options.map(o => <ChoiceCard key={o.id} option={o} onPick={s.pickOption}/>)}
              </div>
            </div>
          )}
          {s.revealed && (
            <div style={{ marginTop:14 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {activePrompt.options.map(o => <ChoiceCard key={o.id} option={o} onPick={()=>{}} revealed picked={o.id===s.pickedId}/>)}
              </div>
              <div style={{ marginTop:14, textAlign:'center' }}>
                {s.nextBeat ? (
                  <button className="icon-btn primary" onClick={s.advance} style={{padding:'10px 22px'}}>Continue →</button>
                ) : (
                  <button className="icon-btn primary" onClick={onFinish} style={{padding:'10px 22px'}}>Finish & review →</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Vitals rail */}
      <aside style={{ background:'var(--paper-card)', padding:'20px 22px', overflow:'auto' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:10 }}>Patient mood</div>
        <MoodWaveform data={s.moodSeries} width={280} height={60} active/>
        <div style={{ height:1, background:'var(--line)', margin:'20px 0' }}/>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:12 }}>Live rubric</div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {Object.entries(s.rubric).map(([k,v]) => <RubricGauge key={k} label={k} value={v}/>)}
        </div>
        {coachOn && s.history.length > 0 && (
          <>
            <div style={{ height:1, background:'var(--line)', margin:'20px 0' }}/>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:10 }}>Coach whisper</div>
            <CoachWhisper hint={s.moodSeries[s.moodSeries.length-1] < 0 ? "She's nervous. Acknowledge before moving forward." : "She just softened — this is a moment to hold."}/>
          </>
        )}
      </aside>
    </div>
  );
};

// -------- Variant B: Cockpit --------
const CockpitSession = ({ scenario, onExit, onFinish, coachOn }) => {
  const persona = PERSONAS[scenario.persona];
  const s = useSession(scenario);
  const lastBeat = s.history[s.history.length-1];
  const activePrompt = scenario.beats.find((b,i) => b.who==='agent' && i === (s.history.length-1) + (lastBeat?.who==='patient'?1:0));

  return (
    <div style={{ display:'grid', gridTemplateColumns:'260px 1fr 280px', height:'calc(100vh - 52px)', background:'var(--paper-2)' }}>
      {/* Left — patient panel */}
      <div style={{ padding:'24px 22px', borderRight:'1px solid var(--line)', background:'var(--paper-card)', display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ textAlign:'center', paddingTop:10 }}>
          <PatientAvatar persona={persona} size={96} mood={s.moodSeries[s.moodSeries.length-1]} speaking={lastBeat?.who==='patient'}/>
          <div style={{ fontFamily:'var(--display)', fontSize:17, fontWeight:500, marginTop:14 }}>{persona.name}</div>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>{persona.age} · {persona.insurance}</div>
        </div>
        <div style={{ background:'var(--paper-2)', padding:'12px 14px', fontSize:12, lineHeight:1.5, color:'var(--ink)', textWrap:'pretty' }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Backstory</div>
          {persona.backstory}
        </div>
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Voice</div>
          <div style={{ fontSize:12, fontStyle:'italic', color:'var(--muted)', textWrap:'pretty' }}>{persona.voice}</div>
        </div>
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Mood</div>
          <MoodWaveform data={s.moodSeries} width={216} height={50} active/>
        </div>
        <button className="icon-btn" onClick={onExit} style={{marginTop:'auto'}}>End session</button>
      </div>

      {/* Center — transcript + choices */}
      <div style={{ display:'flex', flexDirection:'column', padding:'24px 40px', overflow:'auto' }}>
        <div style={{flex:1}}>
          {s.history.map((msg, i) => <TranscriptBubble key={i} who={msg.who} line={msg.line} t={msg.t}/>)}
          {activePrompt && !s.revealed && (
            <div style={{ marginTop:20, padding:'16px 20px', background:'var(--paper-card)', border:'1px dashed var(--accent)', borderRadius:2 }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:12 }}>↳ {activePrompt.prompt}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {activePrompt.options.map(o => <ChoiceCard key={o.id} option={o} onPick={s.pickOption}/>)}
              </div>
            </div>
          )}
          {s.revealed && (
            <div style={{ marginTop:14 }}>
              {activePrompt.options.map(o => <div key={o.id} style={{marginBottom:8}}><ChoiceCard option={o} onPick={()=>{}} revealed picked={o.id===s.pickedId}/></div>)}
              <div style={{ textAlign:'center', marginTop:14 }}>
                {s.nextBeat ? <button className="icon-btn primary" onClick={s.advance} style={{padding:'10px 22px'}}>Continue →</button>
                            : <button className="icon-btn primary" onClick={onFinish} style={{padding:'10px 22px'}}>Finish & review →</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right — live rubric + flags */}
      <aside style={{ padding:'24px 22px', borderLeft:'1px solid var(--line)', background:'var(--paper-card)', overflow:'auto' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:14 }}>Live rubric</div>
        <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:24 }}>
          {Object.entries(s.rubric).map(([k,v]) => <RubricGauge key={k} label={k} value={v}/>)}
        </div>
        <div style={{ height:1, background:'var(--line)', margin:'0 0 20px' }}/>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:10 }}>Hidden objections</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, fontSize:11, lineHeight:1.5, color:'var(--muted)', fontStyle:'italic', textWrap:'pretty' }}>
          {persona.hiddenObjections.map((o,i)=><div key={i}>• {o}</div>)}
        </div>
        {coachOn && (<>
          <div style={{ height:1, background:'var(--line)', margin:'20px 0' }}/>
          <CoachWhisper hint={s.moodSeries[s.moodSeries.length-1] < 0 ? "Mood dipped — acknowledge before solving." : "She's softening. Don't rush into verification."}/>
        </>)}
      </aside>
    </div>
  );
};

// -------- Variant C: Stage (theatrical) --------
const StageSession = ({ scenario, onExit, onFinish, coachOn }) => {
  const persona = PERSONAS[scenario.persona];
  const s = useSession(scenario);
  const lastBeat = s.history[s.history.length-1];
  const activePrompt = scenario.beats.find((b,i) => b.who==='agent' && i === (s.history.length-1) + (lastBeat?.who==='patient'?1:0));
  const mood = s.moodSeries[s.moodSeries.length-1];

  return (
    <div style={{ height:'calc(100vh - 52px)', background:'var(--paper-2)', display:'flex', flexDirection:'column' }}>
      {/* Top strip */}
      <div style={{ padding:'12px 28px', borderBottom:'1px solid var(--line)', background:'var(--paper-card)', display:'flex', gap:16, alignItems:'center' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em' }}>Scene · {scenario.title}</div>
        <div style={{flex:1}}/>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          {Object.entries(s.rubric).slice(0,3).map(([k,v]) => (
            <div key={k} style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>
              <span style={{ textTransform:'uppercase', letterSpacing:'0.08em' }}>{k}</span>
              <span style={{ color:'var(--ink)', marginLeft:6, fontVariantNumeric:'tabular-nums' }}>{v.toFixed(1)}</span>
            </div>
          ))}
        </div>
        <button className="icon-btn" onClick={onExit}>End</button>
      </div>

      {/* Stage */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 40px', position:'relative' }}>
        <PatientAvatar persona={persona} size={140} mood={mood} speaking={lastBeat?.who==='patient'}/>
        <div style={{ fontFamily:'var(--display)', fontSize:22, fontWeight:500, letterSpacing:-0.4, marginTop:18, color:'var(--ink)' }}>{persona.name}</div>
        <div style={{ fontFamily:'var(--ui)', fontSize:13, fontStyle:'italic', color:'var(--muted)', marginTop:4 }}>{persona.voice}</div>

        {/* Spoken line */}
        {lastBeat?.who === 'patient' && (
          <div style={{ maxWidth:640, marginTop:30, fontFamily:'var(--display)', fontSize:22, fontWeight:400, lineHeight:1.45, color:'var(--ink)', textAlign:'center', letterSpacing:-0.2, textWrap:'pretty' }}>
            "{lastBeat.line}"
          </div>
        )}
        {lastBeat?.who === 'agent' && (
          <div style={{ maxWidth:640, marginTop:30, fontFamily:'var(--ui)', fontSize:18, fontStyle:'italic', lineHeight:1.5, color:'var(--muted)', textAlign:'center', textWrap:'pretty' }}>
            You said: "{lastBeat.line}"
          </div>
        )}

        {/* Mood waveform at bottom center */}
        <div style={{ position:'absolute', bottom:30, left:'50%', transform:'translateX(-50%)', width:420, opacity:0.7 }}>
          <MoodWaveform data={s.moodSeries} width={420} height={40} active/>
        </div>
      </div>

      {/* Bottom — prompt + choices */}
      {activePrompt && !s.revealed && (
        <div style={{ background:'var(--paper-card)', borderTop:'1px solid var(--line)', padding:'20px 40px' }}>
          <div style={{ maxWidth:900, margin:'0 auto' }}>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:12 }}>↳ {activePrompt.prompt}</div>
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${activePrompt.options.length}, 1fr)`, gap:10 }}>
              {activePrompt.options.map(o => <ChoiceCard key={o.id} option={o} onPick={s.pickOption}/>)}
            </div>
          </div>
        </div>
      )}
      {s.revealed && (
        <div style={{ background:'var(--paper-card)', borderTop:'1px solid var(--line)', padding:'20px 40px' }}>
          <div style={{ maxWidth:900, margin:'0 auto' }}>
            <div style={{ display:'grid', gridTemplateColumns:`repeat(${activePrompt.options.length}, 1fr)`, gap:10, marginBottom:14 }}>
              {activePrompt.options.map(o => <ChoiceCard key={o.id} option={o} onPick={()=>{}} revealed picked={o.id===s.pickedId}/>)}
            </div>
            <div style={{ textAlign:'center' }}>
              {s.nextBeat ? <button className="icon-btn primary" onClick={s.advance} style={{padding:'10px 22px'}}>Continue →</button>
                          : <button className="icon-btn primary" onClick={onFinish} style={{padding:'10px 22px'}}>Finish & review →</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { ScenarioLibrary, ChatSession, CockpitSession, StageSession });
