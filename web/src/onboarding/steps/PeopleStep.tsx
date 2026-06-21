import { useState } from 'react'
import type { onboardingApi } from '../api'
import type { OnboardingSnapshot, PersonInput, PlatformRole } from '../types'

interface PeopleStepProps {
  token: string
  workspaceId: string | null
  api: ReturnType<typeof onboardingApi>
  onSave: (snapshot: OnboardingSnapshot) => void
  /** Email of the currently signed-in user (owner, cannot be removed/demoted) */
  currentUserEmail?: string
}

interface PersonRow {
  personName: string
  title: string
  email: string
  responsibilities: string
  role: PlatformRole
  accessScope: string
  invite: boolean
}

const EMPTY_ROW: PersonRow = {
  personName: '',
  title: '',
  email: '',
  responsibilities: '',
  role: 'staff',
  accessScope: '',
  invite: false,
}

export function PeopleStep({
  workspaceId: _workspaceId,
  api,
  onSave,
  currentUserEmail,
}: PeopleStepProps) {
  const [people, setPeople] = useState<PersonRow[]>([])
  const [form, setForm] = useState<PersonRow>({ ...EMPTY_ROW })
  const [dupError, setDupError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function isDuplicateEmail(email: string, excludeIdx?: number): boolean {
    const normalized = email.toLowerCase().trim()
    return people.some((p, i) => {
      if (excludeIdx !== undefined && i === excludeIdx) return false
      return p.email.toLowerCase().trim() === normalized
    })
  }

  function handleAddPerson(e: React.FormEvent) {
    e.preventDefault()
    const email = form.email.trim()

    if (isDuplicateEmail(email)) {
      setDupError(`Duplicate email: ${email} is already in the list.`)
      return
    }
    setDupError(null)
    setPeople((prev) => [...prev, { ...form }])
    setForm({ ...EMPTY_ROW })
  }

  function handleRemove(idx: number) {
    const person = people[idx]
    // Cannot remove the owner entry
    if (
      currentUserEmail &&
      person.email.toLowerCase() === currentUserEmail.toLowerCase()
    ) {
      return
    }
    if (person.role === 'owner') return
    setPeople((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const payload: PersonInput[] = people.map((p) => ({
      personName: p.personName,
      title: p.title,
      email: p.email,
      responsibilities: p.responsibilities
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      role: p.role,
      accessScope: p.accessScope ? { scope: p.accessScope } : {},
      invite: p.invite,
    }))
    try {
      const snap = await api.savePeople(payload)
      onSave(snap)
    } catch {
      // Keep state on error
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2>People</h2>

      {dupError && (
        <div role="alert" style={{ color: '#842029', background: '#f8d7da', border: '1px solid #f5c2c7', borderRadius: '4px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
          {dupError}
        </div>
      )}

      {people.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}>
          {people.map((p, idx) => {
            const isOwner =
              (currentUserEmail &&
                p.email.toLowerCase() === currentUserEmail.toLowerCase()) ||
              p.role === 'owner'
            return (
              <li
                key={idx}
                style={{
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <div>
                  <strong>{p.personName}</strong>
                  {p.title && <span> — {p.title}</span>}
                  <div style={{ fontSize: '0.85rem', color: '#6c757d' }}>
                    {p.email} · {p.role}
                  </div>
                  {p.invite && (
                    <div style={{ fontSize: '0.8rem', color: '#0d6efd', marginTop: '0.25rem' }}>
                      Invitation sends when you finish setup
                    </div>
                  )}
                  {isOwner && (
                    <div style={{ fontSize: '0.75rem', color: '#6c757d', marginTop: '0.25rem' }}>
                      (owner — cannot be removed)
                    </div>
                  )}
                </div>
                {!isOwner && (
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                  >
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <form className="step-form" onSubmit={handleAddPerson}>
        <h3>Add person</h3>
        <div className="field">
          <label htmlFor="person-name">Name</label>
          <input
            id="person-name"
            type="text"
            value={form.personName}
            onChange={(e) => setForm((f) => ({ ...f, personName: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="person-title">Title</label>
          <input
            id="person-title"
            type="text"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="person-email">Email</label>
          <input
            id="person-email"
            type="email"
            value={form.email}
            onChange={(e) => {
              setDupError(null)
              setForm((f) => ({ ...f, email: e.target.value }))
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="person-responsibilities">Responsibilities</label>
          <input
            id="person-responsibilities"
            type="text"
            value={form.responsibilities}
            onChange={(e) => setForm((f) => ({ ...f, responsibilities: e.target.value }))}
            placeholder="comma-separated"
          />
        </div>
        <div className="field">
          <label htmlFor="person-role">Role</label>
          <select
            id="person-role"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as PlatformRole }))}
          >
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="compliance_officer">Compliance Officer</option>
            <option value="accountant">Accountant</option>
            <option value="staff">Staff</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="person-access-scope">Access Scope</label>
          <input
            id="person-access-scope"
            type="text"
            value={form.accessScope}
            onChange={(e) => setForm((f) => ({ ...f, accessScope: e.target.value }))}
            placeholder="e.g. finance, hr"
          />
        </div>
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <label htmlFor="person-invite" style={{ margin: 0 }}>Invite</label>
          <input
            id="person-invite"
            type="checkbox"
            checked={form.invite}
            onChange={(e) => setForm((f) => ({ ...f, invite: e.target.checked }))}
          />
        </div>
        <button type="submit">Add person</button>
      </form>

      <form onSubmit={handleSave} style={{ marginTop: '1.5rem' }}>
        <button type="submit" disabled={submitting}>
          Save &amp; Continue
        </button>
      </form>
    </div>
  )
}
