// Audio scrubber: waveform + sentiment ribbon + chapters + playhead.
// Seek by click/drag; play/pause button; playback rate.

const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2,'0')}`;
};

const Scrubber = ({ duration, playhead, playing, onSeek, onTogglePlay, rate, onRate, compact=false }) => {
  const railRef = React.useRef(null);
  const [hoverSec, setHoverSec] = React.useState(null);
  const [dragging, setDragging] = React.useState(false);

  const pct = playhead / duration;

  const pxToSec = (clientX) => {
    const r = railRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    return (x / r.width) * duration;
  };

  const onMouseDown = (e) => {
    setDragging(true);
    onSeek(pxToSec(e.clientX));
  };
  const onMouseMove = (e) => {
    setHoverSec(pxToSec(e.clientX));
    if (dragging) onSeek(pxToSec(e.clientX));
  };
  const onMouseUp = () => setDragging(false);
  const onMouseLeave = () => { setHoverSec(null); setDragging(false); };

  React.useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [dragging]);

  const W = 840; // design width of the rail (scales with container via CSS)
  const railH = compact ? 60 : 84;
  const sentH = 22;

  // Waveform bars
  const bars = WAVEFORM;
  const barW = W / bars.length;

  // Sentiment ribbon path
  const sentPath = React.useMemo(() => {
    const step = 4; // sample every 4 seconds
    let d = '';
    for (let i = 0; i < SENTIMENT_SERIES.length; i += step) {
      const x = (i / duration) * W;
      const v = SENTIMENT_SERIES[i];
      const y = sentH/2 - (v * sentH/2 * 0.9);
      d += (d ? ' L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    return d;
  }, [duration]);

  const sentArea = sentPath + ` L${W},${sentH/2} L0,${sentH/2} Z`;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, width:'100%' }}>
      {/* Transport row */}
      <div style={{ display:'flex', alignItems:'center', gap:14 }}>
        <button
          onClick={onTogglePlay}
          style={{
            width:44, height:44, borderRadius:'50%',
            background:'var(--accent)', color:'var(--paper)',
            border:'none', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 2px 6px rgba(0,0,0,0.1)',
            flexShrink:0,
          }}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg width="14" height="16" viewBox="0 0 14 16"><rect x="0" y="0" width="4" height="16" fill="currentColor"/><rect x="10" y="0" width="4" height="16" fill="currentColor"/></svg>
          ) : (
            <svg width="14" height="16" viewBox="0 0 14 16"><path d="M0,0 L14,8 L0,16 Z" fill="currentColor"/></svg>
          )}
        </button>

        <div style={{ fontFamily:'var(--mono)', fontSize:13, color:'var(--ink)', fontVariantNumeric:'tabular-nums', minWidth:96 }}>
          <span style={{fontWeight:600}}>{fmtTime(playhead)}</span>
          <span style={{ color:'var(--muted)' }}> / {fmtTime(duration)}</span>
        </div>

        <div style={{ flex:1 }}/>

        {/* Chapter quick-jump */}
        <div style={{ display:'flex', gap:4 }}>
          {CHAPTERS.map((c, i) => (
            <button key={i}
              onClick={() => onSeek(c.t)}
              title={c.title}
              style={{
                fontFamily:'var(--mono)', fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase',
                padding:'4px 8px', borderRadius:3,
                border:'1px solid var(--line)',
                background: playhead >= c.t && (CHAPTERS[i+1] ? playhead < CHAPTERS[i+1].t : true) ? 'var(--accent-soft)' : 'transparent',
                color: playhead >= c.t && (CHAPTERS[i+1] ? playhead < CHAPTERS[i+1].t : true) ? 'var(--ink)' : 'var(--muted)',
                cursor:'pointer',
              }}
            >{String(i+1).padStart(2,'0')}</button>
          ))}
        </div>

        <div style={{ display:'flex', gap:2, border:'1px solid var(--line)', borderRadius:3, padding:2 }}>
          {[0.75, 1, 1.25, 1.5, 2].map(r => (
            <button key={r}
              onClick={() => onRate(r)}
              style={{
                fontFamily:'var(--mono)', fontSize:10, padding:'3px 6px',
                background: rate === r ? 'var(--ink)' : 'transparent',
                color: rate === r ? 'var(--paper)' : 'var(--muted)',
                border:'none', cursor:'pointer', borderRadius:2,
              }}
            >{r}×</button>
          ))}
        </div>
      </div>

      {/* Rail — waveform + sentiment */}
      <div
        ref={railRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        style={{
          position:'relative', width:'100%', height: railH,
          background:'var(--paper-2)', border:'1px solid var(--line)',
          cursor: dragging ? 'grabbing' : 'pointer',
          userSelect:'none',
        }}
      >
        <svg width="100%" height={railH} viewBox={`0 0 ${W} ${railH}`} preserveAspectRatio="none" style={{display:'block', pointerEvents:'none'}}>
          {/* waveform bars */}
          {bars.map((v, i) => {
            const x = i * barW;
            const h = v * (railH - sentH - 6);
            const y = (railH - sentH - h) / 2;
            const inPast = (i / bars.length) <= pct;
            return (
              <rect key={i} x={x + 0.5} y={y} width={Math.max(1, barW - 1)} height={h}
                fill={inPast ? 'var(--accent)' : 'var(--muted)'}
                opacity={inPast ? 0.85 : 0.35}
              />
            );
          })}

          {/* sentiment ribbon along bottom */}
          <g transform={`translate(0, ${railH - sentH})`}>
            <rect x="0" y="0" width={W} height={sentH} fill="var(--paper)" opacity="0.6"/>
            <line x1="0" x2={W} y1={sentH/2} y2={sentH/2} stroke="var(--line)" strokeDasharray="2 3"/>
            <path d={sentArea} fill="var(--accent)" opacity="0.15"/>
            <path d={sentPath} stroke="var(--accent)" strokeWidth="1.5" fill="none"/>
          </g>

          {/* chapter markers */}
          {CHAPTERS.map((c, i) => {
            if (c.t === 0) return null;
            const x = (c.t / duration) * W;
            return (
              <line key={i} x1={x} x2={x} y1={0} y2={railH}
                stroke="var(--ink)" strokeOpacity="0.22" strokeDasharray="3 2" strokeWidth="1"/>
            );
          })}

          {/* coaching flags */}
          {SEGMENTS.filter(s => s[5]).map((s, i) => {
            const x = ((s[0]+s[1])/2 / duration) * W;
            const color = s[5].kind === 'good' ? 'var(--good)' : s[5].kind === 'missed' ? 'var(--warn)' : 'var(--accent)';
            return (
              <g key={i}>
                <line x1={x} x2={x} y1={2} y2={railH - sentH - 2} stroke={color} strokeWidth="1.5" opacity="0.8"/>
                <circle cx={x} cy={4} r="3" fill={color}/>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hoverSec != null && (
          <div style={{
            position:'absolute', left:`${(hoverSec/duration)*100}%`, top:-24,
            transform:'translateX(-50%)',
            fontFamily:'var(--mono)', fontSize:10, padding:'2px 6px',
            background:'var(--ink)', color:'var(--paper)', borderRadius:2,
            pointerEvents:'none', whiteSpace:'nowrap',
          }}>{fmtTime(hoverSec)}</div>
        )}

        {/* Playhead */}
        <div style={{
          position:'absolute', left:`${pct*100}%`, top:-2, bottom:-2,
          width:2, background:'var(--ink)', pointerEvents:'none',
          boxShadow:'0 0 0 2px rgba(255,255,255,0.6)',
        }}>
          <div style={{
            position:'absolute', left:-5, top:-5, width:12, height:12,
            borderRadius:'50%', background:'var(--ink)',
            border:'2px solid var(--paper)',
          }}/>
        </div>
      </div>

      {/* Chapter strip */}
      {!compact && (
        <div style={{ display:'flex', alignItems:'stretch', width:'100%', fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)', letterSpacing:'0.05em', textTransform:'uppercase' }}>
          {CHAPTERS.map((c, i) => {
            const start = c.t;
            const end = CHAPTERS[i+1] ? CHAPTERS[i+1].t : duration;
            const width = ((end - start) / duration) * 100;
            const active = playhead >= start && playhead < end;
            return (
              <button key={i}
                onClick={() => onSeek(start)}
                style={{
                  width: `${width}%`, padding:'6px 8px',
                  textAlign:'left',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--muted)',
                  border:'none', borderRight: i < CHAPTERS.length-1 ? '1px solid var(--line)' : 'none',
                  cursor:'pointer',
                  fontFamily:'inherit', fontSize:'inherit',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                }}
              >
                <span style={{color: active ? 'var(--accent)' : 'var(--muted)', fontVariantNumeric:'tabular-nums'}}>{fmtTime(start)}</span>
                <span style={{marginLeft:6}}>{c.title}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

Object.assign(window, { Scrubber, fmtTime });
