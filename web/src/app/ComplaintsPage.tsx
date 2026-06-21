import { useEffect, useState } from 'react'
import { complaintsApi } from './complaints-api'
import type { Complaint, CreateComplaintInput, ComplaintsApi } from './complaints-api'

const CHANNELS = ['email', 'phone', 'web', 'in-person', 'other']
const CATEGORIES = ['product', 'service', 'staff', 'billing', 'compliance', 'other']
const SEVERITIES = ['low', 'medium', 'high', 'critical']

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

interface FormState {
  description: string
  category: string
  channel: string
  severity: string
  complainant_name: string
  complainant_contact: string
}

const EMPTY_FORM: FormState = {
  description: '',
  category: '',
  channel: '',
  severity: '',
  complainant_name: '',
  complainant_contact: '',
}

export interface ComplaintsPageProps {
  token: string
  workspaceId: string
  api?: ComplaintsApi
}

export function ComplaintsPage({ token, workspaceId, api: injectedApi }: ComplaintsPageProps) {
  const api = injectedApi ?? complaintsApi(token, workspaceId)

  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [resolving, setResolving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.list()
      .then((data) => { if (!cancelled) { setComplaints(data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError('Could not load complaints'); setLoading(false) } })
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
    if (!form.description.trim()) {
      setValidationError('Description is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    setValidationError(null)
    const input: CreateComplaintInput = {
      description: form.description,
      ...(form.category ? { category: form.category } : {}),
      ...(form.channel ? { channel: form.channel } : {}),
      ...(form.severity ? { severity: form.severity } : {}),
      ...(form.complainant_name ? { complainant_name: form.complainant_name } : {}),
      ...(form.complainant_contact ? { complainant_contact: form.complainant_contact } : {}),
    }
    try {
      const created = await api.create(input)
      setComplaints((prev) => [...prev, created])
      closeForm()
    } catch {
      setSaveError('Save failed. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleResolve(id: string) {
    setResolving(id)
    try {
      const updated = await api.resolve(id)
      setComplaints((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    } finally {
      setResolving(null)
    }
  }

  const filtered = statusFilter === 'all'
    ? complaints
    : complaints.filter((c) => c.status === statusFilter)

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Module · MOD-E</span>
          <h1 className="page__title">Complaints Register</h1>
          <p className="page__sub">
            Intake, route and resolve complaints — each linked to the rule it touches.
          </p>
        </div>
        <div className="page__head-actions">
          <button className="btn btn--ghost btn--sm">Export</button>
          <button className="btn btn--primary btn--sm" onClick={openAdd}>Log complaint <span className="arrow">+</span></button>
        </div>
      </div>

      {loading && <p>Loading complaints…</p>}
      {error && <p aria-live="assertive">{error}</p>}

      {!loading && !error && (
        <section className="risk">
          <article className="panel xhair register">
            <header className="cardbar">
              <span className="mono cardbar__code">COMPLAINTS</span>
              <span className="mono cardbar__rev">{complaints.length} total</span>
            </header>

            {/* Status filter */}
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border, #e2e8f0)' }}>
              {['all', 'new', 'in_progress', 'resolved', 'closed'].map((s) => (
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
                  <th>Reference</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Channel</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Received</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem', opacity: 0.6 }}>
                      No complaints{statusFilter !== 'all' ? ` with status "${STATUS_LABELS[statusFilter] ?? statusFilter}"` : ''}.
                    </td>
                  </tr>
                )}
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td className="mono rtable__ref">{c.reference ?? c.id.slice(0, 8)}</td>
                    <td className="rtable__title" style={{ maxWidth: '20rem' }}>{c.description}</td>
                    <td className="mono">{c.category ?? '—'}</td>
                    <td className="mono">{c.channel ?? '—'}</td>
                    <td className="mono">{c.severity ?? '—'}</td>
                    <td>
                      <span className={`sevtag sevtag--${c.status === 'new' ? 'high' : c.status === 'in_progress' ? 'med' : 'low'}`}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </td>
                    <td className="mono">{c.received_at ? new Date(c.received_at).toLocaleDateString() : '—'}</td>
                    <td>
                      {(c.status === 'new' || c.status === 'in_progress') && (
                        <button
                          className="btn btn--ghost btn--sm"
                          onClick={() => handleResolve(c.id)}
                          disabled={resolving === c.id}
                          aria-label={`Resolve complaint ${c.reference ?? c.id}`}
                        >
                          {resolving === c.id ? 'Resolving…' : 'Resolve'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </section>
      )}

      {/* Intake form */}
      {formOpen && (
        <div className="panel xhair" role="dialog" aria-modal="true" aria-label="Log complaint" style={{ marginTop: '1.5rem', padding: '1.5rem' }}>
          <h2 className="page__title" style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>
            Log complaint
          </h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '32rem' }}>
              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Description <span aria-hidden="true">*</span></span>
                <textarea
                  aria-required="true"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={4}
                  style={{ width: '100%' }}
                  aria-label="Description"
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Category</span>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  aria-label="Category"
                >
                  <option value="">— select —</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Channel</span>
                <select
                  value={form.channel}
                  onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                  aria-label="Channel"
                >
                  <option value="">— select —</option>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Severity</span>
                <select
                  value={form.severity}
                  onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                  aria-label="Severity"
                >
                  <option value="">— select —</option>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Complainant name</span>
                <input
                  type="text"
                  value={form.complainant_name}
                  onChange={(e) => setForm((f) => ({ ...f, complainant_name: e.target.value }))}
                  style={{ width: '100%' }}
                  aria-label="Complainant name"
                />
              </label>

              <label>
                <span style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Complainant contact</span>
                <input
                  type="text"
                  value={form.complainant_contact}
                  onChange={(e) => setForm((f) => ({ ...f, complainant_contact: e.target.value }))}
                  style={{ width: '100%' }}
                  aria-label="Complainant contact"
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
