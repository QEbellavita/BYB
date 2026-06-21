import { Fragment } from 'react'
import { RISKS } from './data'

const LIKE = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']
const IMPACT = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Severe']

// severity bucket from likelihood×impact (1..25)
function severity(l: number, i: number): 'low' | 'med' | 'high' | 'ext' {
  const s = l * i
  if (s >= 15) return 'ext'
  if (s >= 8) return 'high'
  if (s >= 4) return 'med'
  return 'low'
}
const SEV_LABEL = { low: 'Low', med: 'Medium', high: 'High', ext: 'Extreme' }

export function RiskPage() {
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Module · MOD-J</span>
          <h1 className="page__title">Risk Register</h1>
          <p className="page__sub">
            5×5 likelihood × impact. Severity, owners and review dates — drawn from your risk framework in the Hub.
          </p>
        </div>
        <div className="page__head-actions">
          <button className="btn btn--ghost btn--sm">Export</button>
          <button className="btn btn--primary btn--sm">Add risk <span className="arrow">+</span></button>
        </div>
      </div>

      <section className="risk">
        {/* the 5×5 matrix */}
        <article className="panel xhair matrix">
          <header className="cardbar">
            <span className="mono cardbar__code">5 × 5 MATRIX</span>
            <span className="mono cardbar__rev">{RISKS.length} active risks</span>
          </header>
          <div className="matrix__wrap">
            <div className="matrix__yaxis mono">Likelihood</div>
            <div className="matrix__grid" role="img" aria-label="5 by 5 risk heat matrix">
              {[5, 4, 3, 2, 1].map((l) => (
                <Fragment key={`row-${l}`}>
                  <div className="matrix__rowlabel mono">{LIKE[l - 1]}</div>
                  {[1, 2, 3, 4, 5].map((i) => {
                    const here = RISKS.filter((r) => r.likelihood === l && r.impact === i)
                    const sev = severity(l, i)
                    return (
                      <div className={`cell cell--${sev}`} key={`c-${l}-${i}`} title={`${LIKE[l - 1]} × ${IMPACT[i - 1]}`}>
                        <span className="cell__score mono">{l * i}</span>
                        {here.map((r) => (
                          <span className="cell__chip mono" key={r.ref}>{r.ref}</span>
                        ))}
                      </div>
                    )
                  })}
                </Fragment>
              ))}
              <div className="matrix__corner" />
              {[1, 2, 3, 4, 5].map((i) => (
                <div className="matrix__collabel mono" key={`cl-${i}`}>{IMPACT[i - 1]}</div>
              ))}
            </div>
          </div>
          <footer className="matrix__legend mono">
            {(['low', 'med', 'high', 'ext'] as const).map((s) => (
              <span className="mleg" key={s}><i className={`mleg__sw mleg__sw--${s}`} />{SEV_LABEL[s]}</span>
            ))}
            <span className="matrix__xaxis">Impact →</span>
          </footer>
        </article>

        {/* the register table */}
        <article className="panel xhair register">
          <header className="cardbar">
            <span className="mono cardbar__code">REGISTER</span>
            <span className="mono cardbar__rev">sorted by severity</span>
          </header>
          <table className="rtable">
            <thead>
              <tr>
                <th>Ref</th><th>Risk</th><th>Severity</th><th>Owner</th><th>Review</th>
              </tr>
            </thead>
            <tbody>
              {[...RISKS]
                .sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact)
                .map((r) => {
                  const sev = severity(r.likelihood, r.impact)
                  const due = r.review.startsWith('Due')
                  return (
                    <tr key={r.ref}>
                      <td className="mono rtable__ref">{r.ref}</td>
                      <td className="rtable__title">{r.title}</td>
                      <td>
                        <span className={`sevtag sevtag--${sev}`}>{SEV_LABEL[sev]}</span>
                      </td>
                      <td className="rtable__owner">{r.owner}</td>
                      <td className={`mono rtable__review${due ? ' is-due' : ''}`}>{r.review}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </article>
      </section>
    </div>
  )
}
