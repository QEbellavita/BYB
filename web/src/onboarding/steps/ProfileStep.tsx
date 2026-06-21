import { useState } from 'react'
import type { onboardingApi } from '../api'
import type { OnboardingSnapshot, ProfileInput } from '../types'

interface ProfileStepProps {
  token: string
  workspaceId: string | null
  makeApi: (workspaceId?: string) => ReturnType<typeof onboardingApi>
  onSave: (snapshot: OnboardingSnapshot) => void
  onWorkspaceCreated: (id: string) => void
}

export function ProfileStep({
  workspaceId,
  makeApi,
  onSave,
  onWorkspaceCreated,
}: ProfileStepProps) {
  const [name, setName] = useState('')
  const [jurisdiction, setJurisdiction] = useState<'AU' | 'NZ'>('AU')
  const [size, setSize] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    const input: ProfileInput = { name, jurisdiction, size, description }

    try {
      let ws = workspaceId
      if (!ws) {
        const result = await makeApi().createWorkspace(name)
        ws = result.workspaceId
        onWorkspaceCreated(ws)
      }
      const snap = await makeApi(ws).saveProfile(input)
      onSave(snap)
    } catch {
      // On error, keep current form values (do nothing)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="step-form" onSubmit={handleSubmit}>
      <h2>Profile</h2>

      <div className="field">
        <label htmlFor="profile-name">Business Name</label>
        <input
          id="profile-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="profile-jurisdiction">Jurisdiction</label>
        <select
          id="profile-jurisdiction"
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value as 'AU' | 'NZ')}
        >
          <option value="AU">AU</option>
          <option value="NZ">NZ</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="profile-size">Size</label>
        <input
          id="profile-size"
          type="text"
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="profile-description">Description</label>
        <textarea
          id="profile-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <button type="submit" disabled={submitting}>
        Next
      </button>
    </form>
  )
}
