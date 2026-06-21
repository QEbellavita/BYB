import { HubSchematic } from '../components/HubSchematic'
import { ENTITIES, ACTIVITY, HUB_HEALTH, WORKSPACE } from './data'

export function ContextHubPage({ onOpen }: { onOpen?: (id: string) => void }) {
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Core · ENT-00</span>
          <h1 className="page__title">Context Hub</h1>
          <p className="page__sub">
            Your business’s single source of truth. Defined once — every module reads from here.
          </p>
        </div>
        <div className="page__head-actions">
          <button className="btn btn--ghost btn--sm">View audit log</button>
          <button className="btn btn--primary btn--sm">Define context <span className="arrow">→</span></button>
        </div>
      </div>

      {/* system map + health */}
      <section className="hubtop">
        <article className="panel xhair map">
          <header className="cardbar">
            <span className="mono cardbar__code">SYSTEM MAP</span>
            <span className="mono cardbar__rev">{WORKSPACE.industry} · {WORKSPACE.region}</span>
          </header>
          <div className="map__stage">
            <HubSchematic variant="compact" />
          </div>
        </article>

        <article className="panel xhair health">
          <header className="cardbar">
            <span className="mono cardbar__code">HUB HEALTH</span>
            <span className="dot dot--good" aria-hidden="true" />
          </header>
          <ul className="health__list">
            {HUB_HEALTH.map((h) => (
              <li className="health__row" key={h.k}>
                <span className={`dot dot--${h.status}`} aria-hidden="true" />
                <span className="health__k">{h.k}</span>
                <span className="health__sub mono">{h.sub}</span>
                <span className="health__v tnum">{h.v}</span>
              </li>
            ))}
          </ul>
          <footer className="health__foot mono">
            Last conflict scan: today · all rules consistent
          </footer>
        </article>
      </section>

      {/* entities */}
      <section className="entities">
        <div className="section-head">
          <span className="eyebrow is-muted">The eight Hub entities</span>
          <h2 className="section-head__title">What your business has defined</h2>
        </div>
        <div className="entities__grid">
          {ENTITIES.map((e) => (
            <button
              className="entity xhair"
              key={e.code}
              onClick={() => onOpen?.(e.code === '04' ? 'risk' : 'hub')}
            >
              <header className="entity__head">
                <span className="entity__code mono">ENT-{e.code}</span>
                <span className={`dot dot--${e.status}`} aria-hidden="true" />
              </header>
              <h3 className="entity__name">{e.name}</h3>
              <p className="entity__meta">{e.meta}</p>
              <footer className="entity__foot mono">
                <span>v{e.version}</span>
                <span className="entity__dot">·</span>
                <span>{e.updated}</span>
              </footer>
            </button>
          ))}
        </div>
      </section>

      {/* activity */}
      <section className="activity">
        <div className="section-head">
          <span className="eyebrow is-muted">Versioned + audited</span>
          <h2 className="section-head__title">Recent changes</h2>
        </div>
        <ol className="feed panel">
          {ACTIVITY.map((a, i) => (
            <li className={`feed__row feed__row--${a.kind}`} key={i}>
              <span className="feed__rail" aria-hidden="true" />
              <span className="feed__actor">{a.actor}</span>
              <span className="feed__action">{a.action}</span>
              <span className="feed__target">{a.target}</span>
              <span className="feed__ver mono">{a.version}</span>
              <span className="feed__time mono">{a.time}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
