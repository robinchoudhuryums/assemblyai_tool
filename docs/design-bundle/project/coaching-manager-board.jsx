// Variant B — Manager Board.
// Kanban across lifecycle stages + bulk actions + team heatmap.

const ManagerBoard = ({ items, onOpenItem, onAssignNew }) => {
  const [selectedIds, setSelectedIds] = React.useState(new Set());
  const [agentFilter, setAgentFilter] = React.useState('all');
  const [compFilter, setCompFilter] = React.useState('all');

  const filtered = items.filter(i => {
    if (i.agentId === '*team') return compFilter === 'all' || i.competency === compFilter;
    if (agentFilter !== 'all' && i.agentId !== agentFilter) return false;
    if (compFilter !== 'all' && i.competency !== compFilter) return false;
    return true;
  });

  const byStage = {};
  STAGES.forEach(s => { byStage[s.id] = []; });
  filtered.forEach(i => { (byStage[i.stage] || byStage.open).push(i); });

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };
  const clearSelection = () => setSelectedIds(new Set());

  return (
    <div style={{ padding:'24px 40px', maxWidth:1800, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:24, gap:24 }}>
        <div>
          <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em', marginBottom:8 }}>Your team · 8 agents</div>
          <h1 style={{ fontFamily:'var(--display)', fontSize:32, fontWeight:500, letterSpacing:-0.6, margin:0, color:'var(--ink)', lineHeight:1.15 }}>
            {filtered.length} coaching {filtered.length===1?'item':'items'} in flight
          </h1>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <select className="select" value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
            <option value="all">All agents</option>
            {AGENTS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="select" value={compFilter} onChange={e => setCompFilter(e.target.value)}>
            <option value="all">All competencies</option>
            {COMPETENCIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button className="icon-btn primary" onClick={onAssignNew} style={{padding:'8px 14px'}}>+ Assign new</button>
        </div>
      </div>

      {/* Team heatmap strip */}
      <HeatmapStrip onAgentClick={(id) => setAgentFilter(id)} active={agentFilter}/>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position:'sticky', top:12, zIndex:10,
          background:'var(--ink)', color:'var(--paper)',
          padding:'10px 16px', marginBottom:14,
          display:'flex', alignItems:'center', gap:14,
          fontFamily:'var(--mono)', fontSize:11, letterSpacing:'0.04em',
        }}>
          <span>{selectedIds.size} selected</span>
          <div style={{flex:1}}/>
          <button className="icon-btn" style={{background:'transparent', color:'var(--paper)', borderColor:'rgba(255,255,255,0.3)'}}>Bulk assign</button>
          <button className="icon-btn" style={{background:'transparent', color:'var(--paper)', borderColor:'rgba(255,255,255,0.3)'}}>Mark signed off</button>
          <button className="icon-btn" style={{background:'transparent', color:'var(--paper)', borderColor:'rgba(255,255,255,0.3)'}}>Reassign</button>
          <button className="icon-btn" onClick={clearSelection} style={{background:'transparent', color:'var(--paper)', borderColor:'rgba(255,255,255,0.3)'}}>Clear</button>
        </div>
      )}

      {/* Board */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:14 }}>
        {STAGES.map(stage => (
          <ColumnCol key={stage.id} stage={stage} items={byStage[stage.id]} selectedIds={selectedIds} onToggle={toggleSelect} onOpen={onOpenItem}/>
        ))}
      </div>
    </div>
  );
};

const ColumnCol = ({ stage, items, selectedIds, onToggle, onOpen }) => (
  <div style={{ background:'var(--paper-2)', border:'1px solid var(--line)', borderRadius:2, padding:12, minHeight:400 }}>
    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12, padding:'0 4px' }}>
      <div>
        <div style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:600, color:'var(--ink)', textTransform:'uppercase', letterSpacing:'0.14em' }}>{stage.label}</div>
        <div style={{ fontFamily:'var(--ui)', fontSize:11, color:'var(--muted)', fontStyle:'italic', marginTop:2, textWrap:'pretty' }}>{stage.desc}</div>
      </div>
      <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--muted)', fontVariantNumeric:'tabular-nums' }}>{items.length}</div>
    </div>
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {items.length === 0 && <div style={{ fontFamily:'var(--ui)', fontSize:11, color:'var(--muted)', fontStyle:'italic', padding:'12px 4px', textAlign:'center' }}>—</div>}
      {items.map(item => (
        <BoardCard key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={() => onToggle(item.id)} onOpen={() => onOpen(item.id)}/>
      ))}
    </div>
  </div>
);

const BoardCard = ({ item, selected, onToggle, onOpen }) => {
  const agent = item.agentId === '*team' ? { name:'Whole team', initials:'T' } : AGENTS.find(a => a.id === item.agentId);
  const comp = COMPETENCIES.find(c => c.id === item.competency);
  return (
    <div
      style={{
        background:'var(--paper-card)', border:'1px solid var(--line)',
        borderLeft: `3px solid oklch(55% 0.14 ${comp.hue})`,
        padding:'10px 12px', cursor:'pointer',
        outline: selected ? '2px solid var(--accent)' : 'none',
        outlineOffset:1,
      }}
      onClick={onOpen}
    >
      {/* Top: checkbox + agent + due */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={e => e.stopPropagation()}
          style={{ margin:0, cursor:'pointer', accentColor:'var(--accent)' }}
        />
        <Avatar initials={agent.initials} size={20}/>
        <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--ink)', letterSpacing:'0.02em' }}>{agent.name}</span>
        <div style={{flex:1}}/>
        <DuePill days={item.dueDaysAway}/>
      </div>
      {/* Title */}
      <div style={{ fontFamily:'var(--display)', fontSize:13, fontWeight:500, color:'var(--ink)', lineHeight:1.3, marginBottom:8, textWrap:'pretty' }}>{item.title}</div>
      {/* Footer */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <CompetencyChip id={item.competency} compact/>
        <div style={{flex:1}}/>
        <SourceBadge source={item.source} compact/>
      </div>
      {/* Progress bar if in practice/evidence */}
      {item.practice && (
        <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ flex:1, height:3, background:'var(--paper-2)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ width: (item.practice.scenariosCompleted / item.practice.targetScenarios * 100) + '%', height:'100%', background:'var(--accent)' }}/>
          </div>
          <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', fontVariantNumeric:'tabular-nums' }}>{item.practice.scenariosCompleted}/{item.practice.targetScenarios}</div>
        </div>
      )}
    </div>
  );
};

// --- Heatmap strip: agents × competencies ---
const HeatmapStrip = ({ onAgentClick, active }) => (
  <div style={{ background:'var(--paper-card)', border:'1px solid var(--line)', padding:'16px 20px', marginBottom:20 }}>
    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12 }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.12em' }}>Team skills heatmap</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', display:'flex', gap:10, alignItems:'center' }}>
        <span>low</span>
        <div style={{ display:'flex', gap:0 }}>
          {[0.3, 0.5, 0.7, 0.9].map(v => <div key={v} style={{ width:16, height:10, background:`oklch(${50 + v*20}% ${0.04 + v*0.1} 155)` }}/>)}
        </div>
        <span>high</span>
      </div>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'120px repeat(6, 1fr)', gap:2, alignItems:'center', fontSize:11 }}>
      <div/>
      {COMPETENCIES.map(c => (
        <div key={c.id} style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'0.08em', textAlign:'center', padding:'0 4px', lineHeight:1.2 }}>{c.label}</div>
      ))}
      {AGENTS.map(a => {
        const scores = COMPETENCY_SCORES[a.id] || {};
        return (
          <React.Fragment key={a.id}>
            <div
              onClick={() => onAgentClick(a.id === active ? 'all' : a.id)}
              style={{
                display:'flex', alignItems:'center', gap:8, padding:'6px 0', cursor:'pointer',
                fontFamily:'var(--ui)', fontSize:12, color:'var(--ink)',
                fontWeight: active === a.id ? 600 : 400,
              }}
            >
              <Avatar initials={a.initials} size={20}/>
              <span>{a.name.split(' ')[0]} {a.name.split(' ')[1][0]}.</span>
            </div>
            {COMPETENCIES.map(c => {
              const v = (scores[c.id] || 0) / 100;
              const good = v > 0.6;
              const hue = good ? 155 : 35;
              return (
                <div key={c.id} style={{
                  height:28, background:`oklch(${55 + v*20}% ${0.04 + v*0.1} ${hue})`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontFamily:'var(--mono)', fontSize:10,
                  color: v > 0.7 ? 'var(--paper)' : 'var(--ink)', fontVariantNumeric:'tabular-nums',
                }}>{scores[c.id] || '—'}</div>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  </div>
);

Object.assign(window, { ManagerBoard });
