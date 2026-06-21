import { HubSchematic } from '../components/HubSchematic'

/**
 * Generic scaffold for modules whose detailed UI is still being built.
 * Keeps navigation honest and on-brand instead of dead-ending.
 */
export function ModulePage({ code, name, tagline }: { code: string; name: string; tagline: string }) {
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Module · MOD-{code}</span>
          <h1 className="page__title">{name}</h1>
          <p className="page__sub">{tagline}</p>
        </div>
        <div className="page__head-actions">
          <button className="btn btn--primary btn--sm">Open module <span className="arrow">→</span></button>
        </div>
      </div>

      <section className="empty panel xhair bp-grid">
        <div className="empty__art" aria-hidden="true">
          <HubSchematic variant="compact" />
        </div>
        <div className="empty__copy">
          <span className="tag"><span className="dot dot--ochre" /> Connecting to Hub</span>
          <h2 className="empty__title">This module reads from your Context Hub</h2>
          <p className="empty__body">
            {name} doesn’t start from a blank template. When it comes online it builds itself
            from the rules, obligations and people you’ve already defined — so there’s nothing
            to set up twice.
          </p>
          <div className="empty__actions">
            <button className="btn btn--ghost btn--sm">Notify me when it’s ready</button>
            <button className="btn btn--ghost btn--sm">Back to Hub</button>
          </div>
        </div>
      </section>
    </div>
  )
}
