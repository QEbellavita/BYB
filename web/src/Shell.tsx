import { useEffect, useState } from 'react'
import { WORKSPACE } from './app/data'
import { ContextHubPage } from './app/ContextHubPage'
import { RiskPage } from './app/RiskPage'
import { ModulePage } from './app/ModulePage'
import './app/AppChrome.css'

interface Me { id: string; email: string | null }

interface NavItem { id: string; label: string; code: string; group: 'core' | 'modules' }

const NAV: NavItem[] = [
  { id: 'hub', label: 'Context Hub', code: 'HUB', group: 'core' },
  { id: 'risk', label: 'Risk Register', code: 'J', group: 'modules' },
  { id: 'complaints', label: 'Complaints', code: 'E', group: 'modules' },
  { id: 'processes', label: 'Process Library', code: 'C', group: 'modules' },
  { id: 'documents', label: 'Documents', code: 'D', group: 'modules' },
  { id: 'compliance', label: 'Compliance', code: 'I', group: 'modules' },
  { id: 'people', label: 'People & Roles', code: 'O', group: 'modules' },
  { id: 'reports', label: 'Insights', code: 'L', group: 'modules' },
]

const MODULE_COPY: Record<string, { tagline: string }> = {
  complaints: { tagline: 'Intake, route and resolve complaints — each linked to the rule it touches.' },
  processes: { tagline: 'Chat to build a process; it’s validated against your rules as you write it.' },
  documents: { tagline: 'Versioned on finalisation, with owners, approvals and AI form building.' },
  compliance: { tagline: 'Obligations mapped from your ANZSIC code, tracked against AU/NZ calendars.' },
  people: { tagline: 'Workspace membership, roles and permissions — the org, not a directory.' },
  reports: { tagline: 'Dashboards and weekly reports drawn straight from the Context Hub.' },
}

export function Shell({ fetchMe, onSignOut }: { fetchMe: () => Promise<Me>; onSignOut: () => void }) {
  const [me, setMe] = useState<Me | null>(null)
  const [active, setActive] = useState('hub')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetchMe()
      .then((data) => { setMe(data); setLoading(false) })
      .catch(() => { setError('Could not load your account'); setLoading(false) })
  }, [fetchMe])

  if (loading) return <p>Loading your workspace…</p>
  if (error) return <p aria-live="assertive">{error}</p>

  const initials = (me?.email ?? 'b y').slice(0, 2).toUpperCase()
  const activeItem = NAV.find((n) => n.id === active) ?? NAV[0]

  return (
    <div className="app bp-grid">
      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="brand__mark" aria-hidden="true"><span className="brand__core" /></span>
          <strong>BYB</strong>
        </div>

        <button className="wsswitch" type="button">
          <span className="wsswitch__avatar" aria-hidden="true">{WORKSPACE.name.slice(0, 1)}</span>
          <span className="wsswitch__meta">
            <span className="wsswitch__name">{WORKSPACE.name}</span>
            <span className="wsswitch__sub mono">{WORKSPACE.region} · {WORKSPACE.anzsic}</span>
          </span>
          <span className="wsswitch__chev" aria-hidden="true">⌄</span>
        </button>

        <nav className="nav" aria-label="Workspace">
          <p className="nav__group mono">Core</p>
          {NAV.filter((n) => n.group === 'core').map((n) => (
            <NavButton key={n.id} item={n} active={active === n.id} onClick={() => setActive(n.id)} />
          ))}
          <p className="nav__group mono">Modules</p>
          {NAV.filter((n) => n.group === 'modules').map((n) => (
            <NavButton key={n.id} item={n} active={active === n.id} onClick={() => setActive(n.id)} />
          ))}
        </nav>

        <div className="sidebar__foot">
          <div className="userchip">
            <span className="userchip__avatar" aria-hidden="true">{initials}</span>
            <span className="userchip__meta">
              <span className="userchip__name">{me?.email ?? 'Signed in'}</span>
              <span className="userchip__role mono">Owner · Admin</span>
            </span>
          </div>
          <button className="signout" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────── */}
      <div className="main">
        <header className="topbar">
          <div className="crumbs mono">
            <span>{WORKSPACE.name}</span>
            <span className="crumbs__sep">/</span>
            <span className="crumbs__here">{activeItem.label}</span>
          </div>
          <div className="topbar__tools">
            <label className="search">
              <span className="search__icon" aria-hidden="true">⌕</span>
              <input type="search" placeholder="Search the Hub…" aria-label="Search" />
              <span className="search__kbd mono">/</span>
            </label>
            <button className="iconbtn" aria-label="Notifications" title="Notifications">
              <span className="iconbtn__dot" aria-hidden="true" />⠿
            </button>
            <button className="btn btn--primary btn--sm">New <span className="arrow">+</span></button>
          </div>
        </header>

        <main className="canvas">
          {active === 'hub' && <ContextHubPage onOpen={setActive} />}
          {active === 'risk' && <RiskPage />}
          {active !== 'hub' && active !== 'risk' && (
            <ModulePage
              code={activeItem.code}
              name={activeItem.label}
              tagline={MODULE_COPY[active]?.tagline ?? 'Wired into your Context Hub.'}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`nav__item${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="nav__code mono">{item.code}</span>
      <span className="nav__label">{item.label}</span>
    </button>
  )
}
