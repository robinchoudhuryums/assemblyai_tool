// Shared sidebar nav. Mount with <div id="sidebar-root"></div> and call mountSidebar({active, role}).
// Role-aware items. Collapsible. Fixed width 220 (open) / 56 (collapsed).

const NAV_ITEMS = [
  { id:'dashboard',  label:'Dashboard',  href:'Call Analytics Dashboard.html', roles:['agent','manager','admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.3"/><rect x="8" y="1" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="8" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.3"/><rect x="8" y="8" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id:'calls',      label:'Calls',      href:'Calls.html', roles:['agent','manager','admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><line x1="2" y1="3" x2="12" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="4" cy="3" r="1" fill="currentColor"/><circle cx="4" cy="7" r="1" fill="currentColor"/><circle cx="4" cy="11" r="1" fill="currentColor"/></svg> },
  { id:'transcript', label:'Transcript', href:'Call Transcript Viewer.html', roles:['agent','manager','admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 2 L11 2 L11 12 L3 12 Z" fill="none" stroke="currentColor" strokeWidth="1.3"/><line x1="5" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1"/><line x1="5" y1="7.5" x2="9" y2="7.5" stroke="currentColor" strokeWidth="1"/><line x1="5" y1="10" x2="7.5" y2="10" stroke="currentColor" strokeWidth="1"/></svg> },
  { id:'coaching',   label:'Coaching',   href:'Coaching.html', roles:['agent','manager','admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M2.5 12 Q2.5 8.5 7 8.5 Q11.5 8.5 11.5 12" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id:'simulator',  label:'Simulator',  href:'Simulator.html', roles:['agent','manager','admin'], badge:'β',
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M6 4.5 L9.5 7 L6 9.5 Z" fill="currentColor"/></svg> },
  { id:'sep1', sep:true },
  { id:'team',       label:'Team',       href:'#', roles:['manager','admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="5" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3"/><circle cx="10" cy="6" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M1 12 Q1 8 5 8 Q9 8 9 12" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id:'reports',    label:'Reports',    href:'#', roles:['manager','admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="8" width="2" height="5" fill="currentColor"/><rect x="6" y="5" width="2" height="8" fill="currentColor"/><rect x="10" y="2" width="2" height="11" fill="currentColor"/></svg> },
  { id:'sentiment',  label:'Sentiment',  href:'#', roles:['manager','admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><circle cx="5" cy="6" r="0.8" fill="currentColor"/><circle cx="9" cy="6" r="0.8" fill="currentColor"/><path d="M4.5 9 Q7 11 9.5 9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
  { id:'sep2', sep:true, roles:['admin'] },
  { id:'employees',  label:'Employees',  href:'#', roles:['admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M2 13 Q2 8 7 8 Q12 8 12 13" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id:'admin',      label:'Admin',      href:'#', roles:['admin'],
    icon:<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 L12 4 V8 Q12 11 7 13 Q2 11 2 8 V4 Z" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg> },
];

const LS_KEY = 'cx-sidebar-collapsed';

function Sidebar({ active, role }) {
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem(LS_KEY) === '1');
  const toggle = () => { const n = !collapsed; setCollapsed(n); localStorage.setItem(LS_KEY, n ? '1' : '0'); };

  const user = role === 'agent' ? { name:'Alex Rivera', sub:'Agent · CPAP Intake', initials:'AR' }
             : role === 'manager' ? { name:'Jordan Kim', sub:'Manager · Ops', initials:'JK' }
             : { name:'Taylor West', sub:'Admin · Platform', initials:'TW' };

  return (
    <aside data-collapsed={collapsed ? '1' : '0'} style={{
      flexShrink:0, height:'100vh',
      background:'var(--paper-card)', borderRight:'1px solid var(--line)',
      display:'flex', flexDirection:'column',
      fontFamily:'var(--ui)',
      position:'sticky', top:0, zIndex:5,
      width: collapsed ? '56px' : '220px',
      minWidth: collapsed ? '56px' : '220px',
      maxWidth: collapsed ? '56px' : '220px',
      overflow: 'hidden',
      transition: 'width 0.2s, min-width 0.2s, max-width 0.2s',
    }}>
      {/* Brand */}
      <div style={{padding: collapsed ? '18px 12px' : '18px 16px', borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center', gap:10}}>
        <div style={{
          width:28, height:28, background:'var(--ink)', color:'var(--paper)',
          fontFamily:'var(--display)', fontSize:14, fontWeight:600,
          display:'flex', alignItems:'center', justifyContent:'center',
          borderRadius:3, flexShrink:0,
        }}>∿</div>
        {!collapsed && <div>
          <div style={{fontFamily:'var(--display)', fontSize:13, fontWeight:600, color:'var(--ink)', letterSpacing:'-.2px'}}>UMS Analytics</div>
          <div style={{fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.14em'}}>call intelligence</div>
        </div>}
      </div>

      {/* Nav */}
      <nav style={{flex:1, overflow:'auto', padding:'10px 8px'}}>
        {NAV_ITEMS.filter(it => !it.roles || it.roles.includes(role)).map(it => {
          if (it.sep) return <div key={it.id} style={{height:1, background:'var(--line)', margin:'10px 8px'}}/>;
          const isActive = it.id === active;
          return (
            <a key={it.id} href={it.href}
              style={{
                display:'flex', alignItems:'center', gap:10,
                padding: collapsed ? '9px 12px' : '9px 12px',
                margin:'1px 0', borderRadius:3,
                textDecoration:'none',
                color: isActive ? 'var(--ink)' : 'var(--muted)',
                background: isActive ? 'var(--accent-soft)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                fontSize:13, fontWeight: isActive ? 500 : 400,
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--paper-2)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              title={collapsed ? it.label : ''}
            >
              <span style={{color: isActive ? 'var(--accent)' : 'var(--muted)', display:'flex'}}>{it.icon}</span>
              {!collapsed && <span style={{flex:1}}>{it.label}</span>}
              {!collapsed && it.badge && <span style={{fontFamily:'var(--mono)', fontSize:9, padding:'1px 5px', background:'var(--accent)', color:'var(--paper)', borderRadius:2, letterSpacing:'.05em'}}>{it.badge}</span>}
            </a>
          );
        })}
      </nav>

      {/* User + collapse */}
      <div style={{borderTop:'1px solid var(--line)', padding: collapsed ? '10px 8px' : '12px 14px'}}>
        {!collapsed && (
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10}}>
            <div style={{width:28, height:28, borderRadius:'50%', background:'var(--paper-2)', border:'1px solid var(--line)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--display)', fontSize:11, fontWeight:600, color:'var(--ink)', flexShrink:0}}>{user.initials}</div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:12, color:'var(--ink)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{user.name}</div>
              <div style={{fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.1em'}}>{user.sub}</div>
            </div>
          </div>
        )}
        <button onClick={toggle}
          style={{
            width:'100%', padding:'6px', background:'transparent', border:'1px solid var(--line)',
            cursor:'pointer', color:'var(--muted)', borderRadius:2,
            fontFamily:'var(--mono)', fontSize:10, letterSpacing:'.1em', textTransform:'uppercase',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <span style={{display:'inline-block', transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)'}}>›</span>
          {!collapsed && <span>collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function mountSidebar({ active, role }) {
  const el = document.getElementById('sidebar-root');
  if (!el) return;
  if (!window.__sidebarRoot) window.__sidebarRoot = ReactDOM.createRoot(el);
  window.__sidebarRoot.render(<Sidebar active={active} role={role || 'manager'}/>);
  window.__sidebarState = { active, role };
}

function updateSidebar(partial) {
  const s = { ...(window.__sidebarState || {active:'dashboard', role:'manager'}), ...partial };
  mountSidebar(s);
}

Object.assign(window, { Sidebar, mountSidebar, updateSidebar });
