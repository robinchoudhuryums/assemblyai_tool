// Variant A — Agent Inbox.
// Growth-oriented, "here's your next action" framing. For primary role=agent.

const AgentInbox = ({ items, agentId, onOpenItem, onPracticeClick }) => {
  const agent = AGENTS.find(a => a.id === agentId);
  const progress = AGENT_PROGRESS[agentId] || {};
  const scores = COMPETENCY_SCORES[agentId] || {};

  // filter items for this agent + team-wide items
  const mine = items.filter(i => i.agentId === agentId || i.agentId === '*team');
  const active = mine.filter(i => i.stage !== 'signed-off');
  const completed = mine.filter(i => i.stage === 'signed-off');

  // next action: pick first non-signed-off item, sorted by due + stage
  const nextAction = [...active].sort((a,b) => (a.dueDaysAway ?? 99) - (b.dueDaysAway ?? 99))[0];

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:32, maxWidth:1280, margin:'0 auto', padding:'32px 40px' }}>
      {/* Main column */}
      <div>
        {/* Hero: warm greeting + next action */}
        <div style={{ marginBottom:32 }}>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8 }}>Good afternoon, {agent.name.split(' ')[0]}</div>
          <h1 style={{ fontFamily:'var(--display)', fontSize:36, fontWeight:500, letterSpacing:-0.8, margin:0, color:'var(--ink)', lineHeight:1.15, textWrap:'pretty' }}>
            You're growing. <span style={{color:'var(--muted)'}}>{active.length} open item{active.length===1?'':'s'} · {progress.streak}-call streak.</span>
          </h1>
        </div>

        {/* Next action card */}
        {nextAction && (
          <div style={{
            background:'var(--paper-card)',
            border:'1px solid var(--line)',
            borderLeft:'3px solid var(--accent)',
            padding:'24px 28px',
            marginBottom:32,
            position:'relative',
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, gap:24 }}>
              <div>
                <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', textTransform:'uppercase', letterSpacing:'0.14em', marginBottom:10 }}>↗ Next up</div>
                <h2 style={{ fontFamily:'var(--display)', fontSize:22, fontWeight:500, margin:'0 0 6px', color:'var(--ink)', letterSpacing:-0.3 }}>{nextAction.title}</h2>
                <div style={{ fontFamily:'var(--ui)', fontSize:13, fontStyle:'italic', color:'var(--muted)', maxWidth:520, textWrap:'pretty' }}>{nextAction.growthCopy}</div>
              </div>
              <GrowthRing stage={nextAction.stage} size={80}/>
            </div>

            <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
              <CompetencyChip id={nextAction.competency}/>
              <SourceBadge source={nextAction.source} assignedByName={nextAction.assignedByName}/>
              <div style={{flex:1}}/>
              <DuePill days={nextAction.dueDaysAway}/>
            </div>

            <div style={{ padding:'14px 0', borderTop:'1px solid var(--line)', marginBottom:14 }}>
              <div style={{ fontSize:13, lineHeight:1.55, color:'var(--ink)', maxWidth:620, textWrap:'pretty' }}>{nextAction.issue}</div>
            </div>

            <div style={{ display:'flex', gap:10 }}>
              <button className="icon-btn primary" onClick={() => onOpenItem(nextAction.id)} style={{padding:'10px 18px', fontSize:11}}>Open item →</button>
              {nextAction.practiceLink && <button className="icon-btn" onClick={() => onPracticeClick(nextAction)} style={{padding:'10px 18px', fontSize:11}}>Practice in simulator ({nextAction.practiceLink.duration})</button>}
            </div>
          </div>
        )}

        {/* Active items list */}
        <div style={{ marginBottom:40 }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14 }}>
            <h3 style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:500, margin:0, color:'var(--ink)', textTransform:'uppercase', letterSpacing:'0.14em' }}>Active · {active.length}</h3>
            <button className="icon-btn" style={{fontSize:10}}>+ Self-flag something</button>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {active.map(item => <InboxRow key={item.id} item={item} onOpen={() => onOpenItem(item.id)}/>)}
          </div>
        </div>

        {completed.length > 0 && (
          <div>
            <h3 style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:500, margin:'0 0 14px', color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.14em' }}>Signed off · {completed.length}</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {completed.map(item => <InboxRow key={item.id} item={item} onOpen={() => onOpenItem(item.id)} subdued/>)}
            </div>
          </div>
        )}
      </div>

      {/* Right rail: progress */}
      <aside style={{ position:'sticky', top:24, alignSelf:'start' }}>
        <GrowthPanel agent={agent} progress={progress} scores={scores}/>
      </aside>
    </div>
  );
};

const InboxRow = ({ item, onOpen, subdued }) => (
  <div
    onClick={onOpen}
    style={{
      background:'var(--paper-card)', border:'1px solid var(--line)',
      padding:'14px 18px', cursor:'pointer',
      display:'grid', gridTemplateColumns:'44px 1fr auto', gap:16, alignItems:'center',
      opacity: subdued ? 0.65 : 1,
      transition:'background 0.1s',
    }}
    onMouseEnter={e => !subdued && (e.currentTarget.style.background='var(--paper-2)')}
    onMouseLeave={e => (e.currentTarget.style.background='var(--paper-card)')}
  >
    <GrowthRing stage={item.stage} size={44} strokeW={3}/>
    <div style={{minWidth:0}}>
      <div style={{ fontFamily:'var(--display)', fontSize:15, fontWeight:500, color:'var(--ink)', letterSpacing:-0.1, marginBottom:4, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.title}</div>
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        <CompetencyChip id={item.competency} compact/>
        <SourceBadge source={item.source} compact/>
        <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>·</span>
        <DuePill days={item.dueDaysAway}/>
      </div>
    </div>
    <div style={{ color:'var(--muted)', fontSize:16 }}>→</div>
  </div>
);

const GrowthPanel = ({ agent, progress, scores }) => (
  <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
    {/* Big number: items addressed */}
    <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'20px 22px' }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8 }}>This month</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
        <div style={{ fontFamily:'var(--display)', fontSize:64, fontWeight:500, letterSpacing:-2, color:'var(--accent)', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{progress.addressedThisMonth}</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>items</div>
      </div>
      <div style={{ fontFamily:'var(--ui)', fontSize:13, color:'var(--muted)', fontStyle:'italic', marginTop:4, textWrap:'pretty' }}>addressed — best month yet.</div>
    </div>

    {/* Streak */}
    <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'16px 22px' }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:10 }}>Streak · calls acknowledged</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:8 }}>
        <div style={{ fontFamily:'var(--display)', fontSize:36, fontWeight:500, letterSpacing:-1, color:'var(--ink)', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{progress.streak}</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>in a row</div>
      </div>
      <StreakPips count={progress.streak}/>
    </div>

    {/* Rubric weekly trend */}
    <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'16px 22px' }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:12 }}>Your rubric — last 6 weeks</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:8 }}>
        <div style={{ fontFamily:'var(--display)', fontSize:32, fontWeight:500, letterSpacing:-1, color:'var(--ink)', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{progress.weeklyScore[progress.weeklyScore.length-1].toFixed(1)}</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--good)' }}>▲ {(progress.weeklyScore[progress.weeklyScore.length-1] - progress.weeklyScore[0]).toFixed(1)}</div>
      </div>
      <div style={{ color:'var(--accent)' }}><Sparkline data={progress.weeklyScore} width={240} height={40} stroke="currentColor"/></div>
    </div>

    {/* Competency snapshot */}
    <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'16px 22px' }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:12 }}>Where you're growing</div>
      <CompetencyRadar scores={scores} size={240}/>
    </div>
  </div>
);

Object.assign(window, { AgentInbox });
