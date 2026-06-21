import { useEffect, useState } from 'react'
import { improvementsApi } from './improvements-api'
import type { Improvement, CreateImprovementInput, ImprovementsApi } from './improvements-api'

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  actioned: 'Actioned',
  dismissed: 'Dismissed',
  done: 'Done',
}

const NEXT_STATUSES: Record<string, Array<Improvement['status']>> = {
  open: ['actioned', 'dismissed', 'done'],
  actioned: ['done', 'dismissed'],
  dismissed: ['open'],
  done: [],
}

interface FormState {
  title: string
  detail: string
  suggested_change: string
}

const EMPTY_FORM: FormState = {
  title: '',
  detail: '',
  suggested_change: '',
}

export interface ImprovementsPageProps {
  token: string
  workspaceId: string
  api?: ImprovementsApi
}

export function ImprovementsPage({ token, workspaceId, api: injectedApi }: ImprovementsPageProps) {
  const api = injectedApi ?? improvementsApi(token, workspaceId)

  const [improvements, setImprovements] = useState<Improvement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [actioning, setActioning] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.list()
      .then((data) => { if (!cancelled) { setImprovements(data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Could not load improvements'); setLoading(false) } })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspaceId])

  function openAdd() {
    setForm(EMPTY_FORM)
    setSaveError(null)
    setValidationError(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setSaveError(null)
    setValidationError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      setValidationError('Title is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    setValidationError(null)
    const input: CreateImprovementInput = {
      title: form.title,
      ...(form.detail ? { detail: form.detail } : {}),
      ...(form.suggested_change ? { suggested_change: form.suggested_change } : {}),
    }
    try {
      const created = await api.create(input)
      setImprovements((prev) => [...prev, created])
      closeForm()
    } catch {
      setSaveError('Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetStatus(id: string, status: Improvement['status']) {
    setActioning(id)
    try {
      const updated = await api.setStatus(id, status)
      setImprovements((prev) => prev.map((imp) => (imp.id === updated.id ? updated : imp)))
    } finally {
      setActioning(null)
    }
  }

  const filtered = statusFilter === 'all'
    ? improvements
    : improvements.filter((imp) => imp.status === statusFilter)

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Module · IMP</span>
          <h1 className="page__title">Improvements Register</h1>
          <p className="page__sub">
            Track and action improvements — auto-detected or manually raised.
          </p>
        </div>
        <div className="page__head-actions">
          <button className="btn btn--ghost btn--sm">Export</button>
          <button className="btn btn--primary btn--sm" onClick={openAdd}>Log improvement <span className="arrow">+</span></button>
        </div>
      </div>

      {loading && <p>Loading improvements…</p>}
      {error && <p aria-live="assertive">{error}</p>}

      {!loading && !error && (
        <section className="risk">
          <article className="panel xhair register">
            <header className="cardbar">
              <span className="mono cardbar__code">IMPROVEMENTS</span>
              <span className="mono cardbar__rev">{improvements.length} total</span>
            </header>

            {/* Status filter */}
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
              {(['all', 'open', 'actioned', 'dismissed', 'done'] as const).map((s) => (
                <button
                  key={s}
                  className={`btn btn--sm${statusFilter === s ? ' btn--primary' : ' btn--ghost'}`}
                  onClick={() => setStatusFilter(s)}
                  aria-pressed={statusFilter === s}
                >
                  {s === 'all' ? 'All' : STATUS_LABELS[s] ?? s}
                </button>
              ))}
            </div>

            <table className="rtable">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Title</th>
                  <th>Detail</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', opacity: 0.6 }}>
                      No improvements{statusFilter !== 'all' ? ` with status "${STATUS_LABELS[statusFilter] ?? statusFilter}"` : ''}.
                    </td>
                  </tr>
                )}
                {filtered.map((imp) => (
                  <tr key={imp.id}>
                    <td>
                      <span
                        className={`sevtag sevtag--${imp.source === 'auto' ? 'med' : 'low'}`}
                        aria-label={`Source: ${imp.source}`}
                      >
                        {imp.source === 'auto' ? 'Auto' : 'Manual'}
                      </span>
                    </td>
                    <td className="rtable__title" style={{ maxWidth: '20rem' }}>{imp.title}</td>
                    <td style={{ maxWidth: '16rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{imp.detail ?? '—'}</td>
                    <td className="mono">{imp.trigger_kind ?? '—'}</td>
                    <td>
                      <span className={`sevtag sevtag--${imp.status === 'open' ? 'high' : imp.status === 'actioned' ? 'med' : 'low'}`}>
                        {STATUS_LABELS[imp.status] ?? imp.status}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                      {(NEXT_STATUSES[imp.status] ?? []).map((nextStatus) => (
                        <button
                          key={nextStatus}
                          className="btn btn--ghost btn--sm"
                          onClick={() => handleSetStatus(imp.id, nextStatus)}
                          disabled={actioning === imp.id}
                          aria-label={`Mark improvement as ${nextStatus}`}
                        >
                          {actioning === imp.id ? '…' : STATUS_LABELS[nextStatus] ?? nextStatus}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {/* Manual create form */}
      {formOpen && (
        <div className="panel xhair" role="dialog" aria-modal="true" aria-label="Log improvement" style={{ marginTop: '1.5rem', padding: '1.5rem' }}>
          <h2 className="page__title" style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>
            Log improvement
          </h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '32rem' }}>
              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Title <span aria-hidden="true">*</span></span>
                <input
                  type="text"
                  aria-required="true"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%' }}
                  aria-label="Title"
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Detail</span>
                <textarea
                  value={form.detail}
                  onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
                  rows={3}
                  style={{ width: '100%' }}
                  aria-label="Detail"
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Suggested change</span>
                <textarea
                  value={form.suggested_change}
                  onChange={(e) => setForm((f) => ({ ...f, suggested_change: e.target.value }))}
                  rows={3}
                  style={{ width: '100%' }}
                  aria-label="Suggested change"
                />
              </label>

              {validationError && (
                <p role="alert" aria-live="assertive" style={{ color: 'var(--danger, red)' }}>{validationError}</p>
              )}
              {saveError && (
                <p aria-live="assertive" style={{ color: 'var(--danger, red)' }}>{saveError}</p>
              )}

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn btn--primary btn--sm" disabled={saving}>
                  {saving ? 'Saving…' : 'Submit'}
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
