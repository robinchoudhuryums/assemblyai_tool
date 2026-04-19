// Transcript with speaker labels, sentiment bars, inline coaching highlights.
// Auto-scrolls to active segment during playback.

const CoachIcon = ({ kind }) => {
  if (kind === 'good') return (
    <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3.5 7 L6 9.5 L10.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  );
  if (kind === 'missed') return (
    <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5"/><line x1="7" y1="4" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="7" cy="10" r="0.8" fill="currentColor"/></svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>
  );
};

const Transcript = ({ playhead, onSeek, role, search }) => {
  const containerRef = React.useRef(null);
  const activeRef = React.useRef(null);

  // Find the active segment for current playhead
  const activeIdx = React.useMemo(() => {
    for (let i = 0; i < SEGMENTS.length; i++) {
      const [s, e] = SEGMENTS[i];
      if (playhead >= s && playhead < e) return i;
    }
    return -1;
  }, [playhead]);

  // Auto-scroll (only if user hasn't manually scrolled recently)
  React.useEffect(() => {
    if (activeIdx < 0 || !activeRef.current) return;
    const el = activeRef.current;
    const c = containerRef.current;
    if (!c) return;
    const elTop = el.offsetTop - c.offsetTop;
    const cTop = c.scrollTop;
    const cBot = cTop + c.clientHeight;
    if (elTop < cTop + 80 || elTop > cBot - 160) {
      c.scrollTo({ top: elTop - 120, behavior: 'smooth' });
    }
  }, [activeIdx]);

  return (
    <div
      ref={containerRef}
      style={{
        flex:1, overflow:'auto',
        background:'var(--paper-card)',
        border:'1px solid var(--line)',
        padding:'24px 28px',
        scrollBehavior:'smooth',
      }}
    >
      {SEGMENTS.map((seg, i) => {
        const [start, end, speaker, text, sent, coach] = seg;
        const active = i === activeIdx;
        const past = playhead >= end;

        if (speaker === 'hold') {
          return (
            <div key={i} ref={active ? activeRef : null} style={{
              display:'flex', alignItems:'center', gap:10, margin:'20px 0',
              fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)',
              letterSpacing:'0.1em', textTransform:'uppercase',
              opacity: past || active ? 1 : 0.5,
            }}>
              <div style={{ flex:1, height:1, background:'var(--line)' }}/>
              <span style={{ padding:'0 8px' }}>{text}</span>
              <div style={{ flex:1, height:1, background:'var(--line)' }}/>
            </div>
          );
        }

        const isAgent = speaker === 'agent';
        const matchesSearch = search && text.toLowerCase().includes(search.toLowerCase());

        return (
          <div
            key={i}
            ref={active ? activeRef : null}
            onClick={() => onSeek(start)}
            style={{
              display:'grid',
              gridTemplateColumns:'48px 1fr',
              columnGap:16,
              padding:'10px 12px',
              margin:'2px -12px',
              borderRadius:3,
              background: active ? 'var(--accent-soft)' : matchesSearch ? 'rgba(255,230,150,0.35)' : 'transparent',
              cursor:'pointer',
              opacity: past || active ? 1 : 0.82,
              transition:'opacity 0.2s, background 0.15s',
              position:'relative',
            }}
            className="transcript-seg"
          >
            {/* Timestamp */}
            <div style={{
              fontFamily:'var(--mono)', fontSize:11, color: active ? 'var(--accent)' : 'var(--muted)',
              fontVariantNumeric:'tabular-nums', paddingTop:3, fontWeight: active ? 600 : 400,
            }}>
              {fmtTime(start)}
            </div>

            {/* Content */}
            <div>
              {/* Speaker label */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                <div style={{
                  fontFamily:'var(--display)', fontSize:12, fontWeight:600,
                  color: isAgent ? 'var(--accent)' : 'var(--ink)',
                  letterSpacing:'0.02em',
                }}>
                  {isAgent ? CALL_META.agent.name : CALL_META.customer.name}
                </div>
                <div style={{
                  fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)',
                  textTransform:'uppercase', letterSpacing:'0.12em',
                }}>
                  {isAgent ? 'Agent' : 'Patient'}
                </div>
                {sent != null && Math.abs(sent) > 0.3 && (
                  <div style={{
                    width:6, height:6, borderRadius:'50%',
                    background: sent > 0 ? 'var(--good)' : 'var(--warn)',
                    opacity: Math.min(1, Math.abs(sent) * 1.2),
                  }} title={`sentiment ${sent.toFixed(2)}`}/>
                )}
              </div>

              {/* Text */}
              <div style={{
                fontSize:14, lineHeight:1.58,
                color: active ? 'var(--ink)' : 'var(--ink)',
                fontFamily:'var(--ui)',
                paddingLeft: isAgent ? 0 : 0,
                borderLeft: !isAgent ? '2px solid var(--line)' : 'none',
                paddingLeftOverride: !isAgent ? 10 : 0,
              }}>
                {highlightSearch(text, search)}
              </div>

              {/* Coaching annotation */}
              {coach && (
                <CoachCard coach={coach} role={role} />
              )}
            </div>
          </div>
        );
      })}

      {/* Tail padding */}
      <div style={{ height:100 }}/>
    </div>
  );
};

const highlightSearch = (text, q) => {
  if (!q) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'ig'));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase()
      ? <mark key={i} style={{background:'rgba(255,220,100,0.6)', color:'var(--ink)', padding:'0 2px'}}>{p}</mark>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
};

const CoachCard = ({ coach, role }) => {
  const color = coach.kind === 'good' ? 'var(--good)' : coach.kind === 'missed' ? 'var(--warn)' : 'var(--accent)';
  const kindLabel = coach.kind === 'good' ? 'Well done' : coach.kind === 'missed' ? 'Missed opportunity' : 'Noticed';

  return (
    <div style={{
      marginTop:10,
      display:'flex', gap:10,
      padding:'10px 12px',
      background:'var(--paper-2)',
      borderLeft:`3px solid ${color}`,
      fontSize:12,
    }}>
      <div style={{ color, paddingTop:1 }}>
        <CoachIcon kind={coach.kind}/>
      </div>
      <div style={{ flex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
          <span style={{
            fontFamily:'var(--mono)', fontSize:9, color, textTransform:'uppercase', letterSpacing:'0.14em', fontWeight:600,
          }}>{kindLabel}</span>
          <span style={{ fontFamily:'var(--display)', fontSize:12, fontWeight:600, color:'var(--ink)' }}>
            {coach.label}
          </span>
        </div>
        <div style={{ color:'var(--muted)', lineHeight:1.5, fontSize:12 }}>
          {coach.note}
        </div>
        {role === 'manager' && (
          <div style={{ marginTop:8, display:'flex', gap:8 }}>
            <button style={coachBtn}>＋ Add to coaching doc</button>
            <button style={coachBtn}>Flag for review</button>
          </div>
        )}
      </div>
    </div>
  );
};

const coachBtn = {
  fontFamily:'var(--mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
  padding:'4px 8px', background:'var(--paper-card)', border:'1px solid var(--line)',
  color:'var(--muted)', cursor:'pointer', borderRadius:2,
};

Object.assign(window, { Transcript, CoachIcon });
