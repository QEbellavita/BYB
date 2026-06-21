import './Landing.css'
import { HubSchematic } from '../components/HubSchematic'

interface LandingProps {
  onStart: () => void
  onSignIn: () => void
}

const STEPS = [
  {
    n: '01',
    title: 'Define your context',
    body: 'Capture how your business actually operates — rules, obligations, risk appetite, and who does what. Once, in plain language.',
  },
  {
    n: '02',
    title: 'Modules build themselves',
    body: 'Risk, complaints, documents and training assemble from your context instead of a blank template. They already know your business.',
  },
  {
    n: '03',
    title: 'Change once, propagate',
    body: 'Update a rule and every affected process, form and obligation moves with it. Conflicts are caught before they ship, not after.',
  },
]

const MODULES = [
  { code: 'J', name: 'Risk Register', body: '5×5 likelihood × impact, severity mapping and review-due tracking.' },
  { code: 'E', name: 'Complaints Register', body: 'Intake, smart routing and root-cause — linked to the rules they breach.' },
  { code: 'C', name: 'Process Library', body: 'Chat to build a process; it’s validated against your rules as you write it.' },
  { code: 'D', name: 'Document Library', body: 'Versioned on finalisation, with owners, approvals and AI form building.' },
  { code: 'I', name: 'Compliance', body: 'Your ANZSIC code maps to the obligations that actually apply to you.' },
  { code: 'O', name: 'People & Roles', body: 'Workspace membership, roles and permissions — the org, not a directory.' },
  { code: 'H', name: 'Trackers', body: 'Build-your-own trackers over any Hub entity. No spreadsheet required.' },
  { code: 'K', name: 'Project Manager', body: 'Tasks, dependencies and timelines that respect your business calendar.' },
  { code: 'M', name: 'Finance', body: 'Xero, MYOB, Stripe AU and Square — payments and books, connected.' },
]

const COMPLIANCE_TILES = [
  { k: 'ANZSIC → obligations', v: 'Industry-mapped' },
  { k: 'AU + NZ calendars', v: 'Holiday-aware' },
  { k: 'ISO-week reporting', v: 'Period-accurate' },
  { k: 'Versioned + audited', v: 'Every change' },
]

export function Landing({ onStart, onSignIn }: LandingProps) {
  return (
    <div className="lp bp-grid">
      {/* ── NAV ───────────────────────────────────────────── */}
      <header className="lp-nav">
        <div className="container lp-nav__inner">
          <a className="brand" href="#/" aria-label="BYB home">
            <span className="brand__mark" aria-hidden="true">
              <span className="brand__core" />
            </span>
            <span className="brand__type">
              <strong>BYB</strong>
              <em>Build Your Business</em>
            </span>
          </a>
          <nav className="lp-nav__links" aria-label="Primary">
            <a href="#principle">Principle</a>
            <a href="#modules">Modules</a>
            <a href="#compliance">Compliance</a>
          </nav>
          <div className="lp-nav__actions">
            <button className="lp-link-btn" onClick={onSignIn}>Sign in</button>
            <button className="btn btn--primary btn--sm" onClick={onStart}>
              Start building <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO ──────────────────────────────────────────── */}
      <section className="hero container">
        <div className="hero__copy">
          <span className="eyebrow">Context-driven operating system · AU / NZ</span>
          <h1 className="hero__title">
            Build the operating system<br />
            your business <span className="hl">runs on.</span>
          </h1>
          <p className="hero__lede">
            Define your rules, risks, processes and obligations once — in a single
            Context Hub. Every tool you add reads from it and adapts. No more
            spreadsheets quietly contradicting each other.
          </p>
          <div className="hero__cta">
            <button className="btn btn--primary" onClick={onStart}>
              Start building <span className="arrow">→</span>
            </button>
            <a className="btn btn--ghost" href="#principle">See how it works</a>
          </div>
          <div className="hero__spec">
            <span>One source of truth</span>
            <i />
            <span>9 modules</span>
            <i />
            <span>Versioned + audited</span>
          </div>
        </div>

        <figure className="hero__fig panel xhair">
          <figcaption className="fig__caption">
            <span className="mono">FIG. 01 — CONTEXT HUB</span>
            <span className="mono fig__rev">REV v1.0</span>
          </figcaption>
          <div className="fig__stage">
            <HubSchematic variant="hero" />
          </div>
          <div className="fig__legend mono">
            <span><i className="lg lg--ink" /> module</span>
            <span><i className="lg lg--ochre" /> needs attention</span>
            <span><i className="lg lg--core" /> source of truth</span>
          </div>
        </figure>
      </section>

      {/* ── PRINCIPLE ─────────────────────────────────────── */}
      <section className="principle container" id="principle">
        <div className="principle__head">
          <span className="eyebrow">The principle</span>
          <h2 className="sec-title">
            Define once.<br />Everything downstream stays in sync.
          </h2>
        </div>
        <ol className="steps">
          {STEPS.map((s) => (
            <li className="step" key={s.n}>
              <span className="step__n mono">{s.n}</span>
              <h3 className="step__title">{s.title}</h3>
              <p className="step__body">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── MODULES ───────────────────────────────────────── */}
      <section className="modules container" id="modules">
        <div className="modules__head">
          <span className="eyebrow">The module library</span>
          <h2 className="sec-title">Nine tools. One shared brain.</h2>
          <p className="modules__lede">
            Add what you need, when you need it. Each module is wired into the
            Context Hub — so it never asks you to re-enter what your business
            already knows.
          </p>
        </div>
        <div className="modules__grid">
          {MODULES.map((m) => (
            <article className="mod xhair" key={m.code}>
              <header className="mod__head">
                <span className="mod__code mono">MOD-{m.code}</span>
                <span className="mod__node" aria-hidden="true" />
              </header>
              <h3 className="mod__name">{m.name}</h3>
              <p className="mod__body">{m.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── COMPLIANCE ────────────────────────────────────── */}
      <section className="compliance" id="compliance">
        <div className="container compliance__inner">
          <div className="compliance__copy">
            <span className="eyebrow">Built for AU / NZ</span>
            <h2 className="sec-title sec-title--light">
              Compliance that knows<br />where you operate.
            </h2>
            <p className="compliance__lede">
              Choose your ANZSIC industry code and jurisdiction. BYB maps it to the
              obligations, calendars and public holidays that apply to you — and keeps
              them current as the rules change.
            </p>
            <button className="btn btn--primary" onClick={onStart}>
              Map my obligations <span className="arrow">→</span>
            </button>
          </div>
          <ul className="compliance__tiles">
            {COMPLIANCE_TILES.map((t) => (
              <li className="ctile" key={t.k}>
                <span className="ctile__v">{t.v}</span>
                <span className="ctile__k mono">{t.k}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────── */}
      <section className="cta container">
        <div className="cta__panel panel xhair bp-grid">
          <span className="eyebrow">Get started</span>
          <h2 className="cta__title">Stop running your<br />business from memory.</h2>
          <p className="cta__body">
            Capture your context once. Start with the Hub, add modules as you grow.
          </p>
          <button className="btn btn--primary" onClick={onStart}>
            Start building <span className="arrow">→</span>
          </button>
        </div>
      </section>

      {/* ── FOOTER / TITLE BLOCK ──────────────────────────── */}
      <footer className="titleblock">
        <div className="container titleblock__inner">
          <div className="tb tb--brand">
            <span className="brand__mark" aria-hidden="true"><span className="brand__core" /></span>
            <strong>BYB</strong>
          </div>
          <dl className="tb tb--meta">
            <div><dt>Project</dt><dd>BYB Platform</dd></div>
            <div><dt>Discipline</dt><dd>Context-Driven OS</dd></div>
            <div><dt>Region</dt><dd>AU · NZ</dd></div>
          </dl>
          <dl className="tb tb--meta">
            <div><dt>Scale</dt><dd>1:1</dd></div>
            <div><dt>Rev</dt><dd>v1.0</dd></div>
            <div><dt>Sheet</dt><dd>01 / 01</dd></div>
          </dl>
          <nav className="tb tb--links" aria-label="Footer">
            <a href="#principle">Principle</a>
            <a href="#modules">Modules</a>
            <a href="#compliance">Compliance</a>
            <button className="lp-link-btn" onClick={onSignIn}>Sign in</button>
          </nav>
        </div>
        <div className="container titleblock__rule mono">
          <span>© {2026} BYB — Build Your Business</span>
          <span>Drawn to spec · one source of truth</span>
        </div>
      </footer>
    </div>
  )
}
