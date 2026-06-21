import { useState } from 'react'
import type { onboardingApi } from '../api'
import type { OnboardingSnapshot, RuleInput } from '../types'
import { hasDivergentConflict } from '../conflicts'

interface ReviewStepProps {
  token: string
  workspaceId: string | null
  /** Persisted snapshot data — ReviewStep renders THIS, not unsaved local state */
  snapshot: OnboardingSnapshot
  api: ReturnType<typeof onboardingApi>
  onComplete: () => void
}

export function ReviewStep({ workspaceId: _workspaceId, snapshot, api, onComplete }: ReviewStepProps) {
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)

  // Normalise persisted rules for conflict detection
  const rules = (snapshot.rules ?? []) as unknown as RuleInput[]
  const conflicted = hasDivergentConflict(rules)

  // Normalise persisted obligations into groups
  const obligations = snapshot.obligations as Array<Record<string, unknown>>
  const activeObligations = obligations.filter((o) => o['status'] === 'active')
  const draftObligations = obligations.filter((o) => o['status'] !== 'active')

  // Normalise persisted people who have invite=true
  const people = snapshot.people as Array<Record<string, unknown>>
  const invitedPeople = people.filter((p) => p['invite'] === true)

  async function handleFinish(e: React.FormEvent) {
    e.preventDefault()
    if (!confirmed) return
    setSubmitting(true)
    setFinishError(null)
    try {
      await api.finish()
      onComplete()
    } catch (err) {
      // Stay on Review screen — data intact
      setFinishError(
        err instanceof Error ? err.message : 'Failed to finish setup. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2>Review</h2>
      <p>Review your onboarding details before finishing.</p>

      {finishError && (
        <div
          role="alert"
          style={{
            color: '#842029',
            background: '#f8d7da',
            border: '1px solid #f5c2c7',
            borderRadius: '4px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
          }}
        >
          {finishError}
        </div>
      )}

      {/* Section 1: Activates now */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h3>Activates now</h3>
        {activeObligations.length === 0 ? (
          <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>No obligations set to activate immediately.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {activeObligations.map((o, i) => (
              <li
                key={String(o['id'] ?? i)}
                style={{
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  padding: '0.6rem 0.75rem',
                  marginBottom: '0.4rem',
                }}
              >
                <strong>{String(o['name'] ?? '')}</strong>
                {o['description'] != null && (
                  <div style={{ fontSize: '0.85rem', color: '#495057', marginTop: '0.2rem' }}>
                    {String(o['description'])}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section 2: Remains draft */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h3>Remains draft</h3>
        {draftObligations.length === 0 ? (
          <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>No draft obligations.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {draftObligations.map((o, i) => (
              <li
                key={String(o['id'] ?? i)}
                style={{
                  border: '1px solid #ffc107',
                  borderRadius: '4px',
                  padding: '0.6rem 0.75rem',
                  marginBottom: '0.4rem',
                  background: '#fffbf0',
                }}
              >
                <strong>{String(o['name'] ?? '')}</strong>
                {o['description'] != null && (
                  <div style={{ fontSize: '0.85rem', color: '#495057', marginTop: '0.2rem' }}>
                    {String(o['description'])}
                  </div>
                )}
                <div style={{ fontSize: '0.75rem', color: '#856404', marginTop: '0.2rem' }}>
                  Draft — verification required
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section 3: Emails after completion */}
      <section style={{ marginBottom: '1.5rem' }}>
        <h3>Emails after completion</h3>
        {invitedPeople.length === 0 ? (
          <p style={{ color: '#6c757d', fontSize: '0.9rem' }}>No invitations queued.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {invitedPeople.map((p, i) => (
              <li
                key={String(p['id'] ?? i)}
                style={{
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  padding: '0.6rem 0.75rem',
                  marginBottom: '0.4rem',
                }}
              >
                <strong>{String(p['personName'] ?? p['email'] ?? '')}</strong>
                {p['email'] != null && (
                  <span style={{ fontSize: '0.85rem', color: '#6c757d', marginLeft: '0.5rem' }}>
                    {String(p['email'])}
                  </span>
                )}
                <div style={{ fontSize: '0.8rem', color: '#0d6efd', marginTop: '0.2rem' }}>
                  Invitation sends when you finish setup
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {conflicted && (
        <aside
          role="note"
          style={{
            color: '#856404',
            background: '#fff3cd',
            border: '1px solid #ffecb5',
            borderRadius: '4px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
          }}
        >
          One or more rules have divergent conflicts (same area and statement but different value or
          consequence for overlapping audiences). Resolve the conflicts in the Rules step before
          finishing.
        </aside>
      )}

      <form onSubmit={handleFinish}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              style={{ marginTop: '0.15rem', flexShrink: 0 }}
            />
            <span>
              I have reviewed this setup and understand suggested obligations remain drafts.
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={!confirmed || submitting || conflicted}
          style={{
            padding: '0.5rem 1.25rem',
            background: confirmed && !conflicted ? '#0d6efd' : '#6c757d',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: confirmed && !conflicted ? 'pointer' : 'not-allowed',
            fontSize: '1rem',
          }}
        >
          {submitting ? 'Finishing…' : 'Finish'}
        </button>
      </form>
    </div>
  )
}
