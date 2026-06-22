import { Fragment, useEffect, useState } from 'react'
import { riskApi } from './risk-api'
import type { Risk, CreateRiskInput, RiskApi } from './risk-api'

const LIKE = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']
const IMPACT = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Severe']

// severity bucket aligned with server severityBucket:
// low < 6 / med 6–11 / high 12–14 / ext ≥ 15
function severity(l: number, i: number): 'low' | 'med' | 'high' | 'ext' {
  const s = l * i
  if (s >= 15) return 'ext'
  if (s >= 12) return 'high'
  if (s >= 6) return 'med'
  return 'low'
}

const SEV_LABEL = { low: 'Low', med: 'Medium', high: 'High', ext: 'Extreme' }

interface FormState {
  title: string
  likelihood: number
  impact: number
  description: string
  category: string
}

const EMPTY_FORM: FormState = {
  title: '',
  likelihood: 1,
  impact: 1,
  description: '',
  category: '',
}

export interface RiskPageProps {
  token: string
  workspaceId: string
  api?: RiskApi
}

export function RiskPage({ token, workspaceId, api: injectedApi }: RiskPageProps) {
  const api = injectedApi ?? riskApi(token, workspaceId)

  const [risks, setRisks] = useState<Risk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.list()
      .then((data) => { if (!cancelled) { setRisks(data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Could not load risks'); setLoading(false) } })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspaceId])

  function openAdd() {
    setEditingRisk(null)
    setForm(EMPTY_FORM)
    setSaveError(null)
    setFormOpen(true)
  }

  function openEdit(r: Risk) {
    setEditingRisk(r)
    setForm({
      title: r.title,
      likelihood: r.likelihood,
      impact: r.impact,
      description: r.description ?? '',
      category: r.category ?? '',
    })
    setSaveError(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingRisk(null)
    setSaveError(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    const input: CreateRiskInput = {
      title: form.title,
      likelihood: Number(form.likelihood),
      impact: Number(form.impact),
      ...(form.description ? { description: form.description } : {}),
      ...(form.category ? { category: form.category } : {}),
    }
    try {
      if (editingRisk) {
        const updated = await api.update(editingRisk.id, { ...input, version: editingRisk.version })
        setRisks((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await api.create(input)
        setRisks((prev) => [...prev, created])
      }
      closeForm()
    } catch {
      setSaveError('Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const activeRisks = risks.filter((r) => r.status !== 'closed')

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
          <button className="btn btn--primary btn--sm" onClick={openAdd}>Add risk <span className="arrow">+</span></button>
        </div>
      </div>

      {loading && <p>Loading risks…</p>}
      {error && <p aria-live="assertive">{error}</p>}

      {!loading && !error && (
        <section className="risk">
          {/* the 5×5 matrix */}
          <article className="panel xhair matrix">
            <header className="cardbar">
              <span className="mono cardbar__code">5 × 5 MATRIX</span>
              <span className="mono cardbar__rev">{activeRisks.length} active risks</span>
            </header>
            <div className="matrix__wrap">
              <div className="matrix__yaxis mono">Likelihood</div>
              <div className="matrix__grid" role="img" aria-label="5 by 5 risk heat matrix">
                {[5, 4, 3, 2, 1].map((l) => (
                  <Fragment key={`row-${l}`}>
                    <div className="matrix__rowlabel mono">{LIKE[l - 1]}</div>
                    {[1, 2, 3, 4, 5].map((i) => {
                      const here = activeRisks.filter((r) => r.likelihood === l && r.impact === i)
                      const sev = severity(l, i)
                      return (
                        <div className={`cell cell--${sev}`} key={`c-${l}-${i}`} title={`${LIKE[l - 1]} × ${IMPACT[i - 1]}`}>
                          <span className="cell__score mono">{l * i}</span>
                          {here.map((r) => (
                            <span
                              className="cell__chip mono"
                              key={r.id}
                              onClick={() => openEdit(r)}
                              style={{ cursor: 'pointer' }}
                            >
                              {r.id.slice(0, 6)}
                            </span>
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
                  <th>Ref</th><th>Risk</th><th>Severity</th><th>Owner</th><th>Review</th><th></th>
                </tr>
              </thead>
              <tbody>
                {[...activeRisks]
                  .sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact)
                  .map((r) => {
                    const sev = severity(r.likelihood, r.impact)
                    const reviewDisplay = r.review_date ?? '—'
                    return (
                      <tr key={r.id}>
                        <td className="mono rtable__ref">{r.id.slice(0, 8)}</td>
                        <td className="rtable__title">{r.title}</td>
                        <td>
                          <span className={`sevtag sevtag--${sev}`}>{SEV_LABEL[sev]}</span>
                        </td>
                        <td className="rtable__owner">{r.owner_person_id ?? '—'}</td>
                        <td className="mono rtable__review">{reviewDisplay}</td>
                        <td>
                          <button className="btn btn--ghost btn--sm" onClick={() => openEdit(r)}>Edit</button>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {/* Add / Edit form panel */}
      {formOpen && (
        <div className="panel xhair" role="dialog" aria-modal="true" aria-label={editingRisk ? 'Edit risk' : 'Add risk'} style={{ marginTop: '1.5rem', padding: '1.5rem' }}>
          <h2 className="page__title" style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>
            {editingRisk ? 'Edit risk' : 'Add risk'}
          </h2>
          <form onSubmit={handleSave}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '32rem' }}>
              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Title</span>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Likelihood</span>
                <select
                  value={form.likelihood}
                  onChange={(e) => setForm((f) => ({ ...f, likelihood: Number(e.target.value) }))}
                >
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>{v} — {LIKE[v - 1]}</option>
                  ))}
                </select>
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Impact</span>
                <select
                  value={form.impact}
                  onChange={(e) => setForm((f) => ({ ...f, impact: Number(e.target.value) }))}
                >
                  {[1, 2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>{v} — {IMPACT[v - 1]}</option>
                  ))}
                </select>
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Description</span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  style={{ width: '100%' }}
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Category</span>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </label>

              {saveError && <p aria-live="assertive" style={{ color: 'var(--danger, red)' }}>{saveError}</p>}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={closeForm} disabled={saving}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
