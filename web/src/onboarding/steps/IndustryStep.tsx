import { useState } from 'react'
import { AnzsicSelector } from '../anzsic/AnzsicSelector'
import { obligationSuggestionsFor } from '../anzsic/catalogue'
import type { onboardingApi } from '../api'
import type { ObligationInput, OnboardingSnapshot } from '../types'

interface IndustryStepProps {
  token: string
  workspaceId: string | null
  api: ReturnType<typeof onboardingApi>
  onSave: (snapshot: OnboardingSnapshot) => void
}

interface SuggestionState {
  checked: boolean
  name: string
  description: string
}

export function IndustryStep({ workspaceId: _workspaceId, api, onSave }: IndustryStepProps) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<SuggestionState[]>([])
  const [submitting, setSubmitting] = useState(false)

  function handleCodeChange(code: string) {
    setSelectedCode(code)
    const raw = obligationSuggestionsFor(code)
    setSuggestions(
      raw.map((s) => ({
        checked: false,
        name: s.title,
        description: s.description,
      })),
    )
  }

  function toggleChecked(idx: number) {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, checked: !s.checked } : s)),
    )
  }

  function updateName(idx: number, name: string) {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, name } : s)),
    )
  }

  function updateDescription(idx: number, description: string) {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, description } : s)),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCode) return
    setSubmitting(true)
    const obligations: ObligationInput[] = suggestions
      .filter((s) => s.checked)
      .map((s) => ({ name: s.name, description: s.description }))
    try {
      const snap = await api.saveIndustry({ anzsicCode: selectedCode, obligations })
      onSave(snap)
    } catch {
      // Keep form state on error
    } finally {
      setSubmitting(false)
    }
  }

  const checkedCount = suggestions.filter((s) => s.checked).length

  return (
    <form className="step-form" onSubmit={handleSubmit}>
      <h2>Industry</h2>

      <p role="note">
        General setup guidance only—not legal advice. Verify each obligation before activation.
      </p>

      <AnzsicSelector value={selectedCode} onChange={handleCodeChange} />

      {suggestions.length > 0 && (
        <div className="obligation-suggestions">
          <h3>Suggested obligations for this industry</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}>
            {suggestions.map((s, idx) => (
              <li
                key={idx}
                style={{
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  padding: '0.75rem',
                  marginBottom: '0.5rem',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={s.checked}
                    onChange={() => toggleChecked(idx)}
                    style={{ marginTop: '0.2rem', flexShrink: 0 }}
                  />
                  <span style={{ flex: 1 }}>
                    {s.checked && (
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '0.75rem',
                          background: '#fff3cd',
                          border: '1px solid #ffc107',
                          borderRadius: '3px',
                          padding: '0.1rem 0.4rem',
                          marginBottom: '0.4rem',
                        }}
                      >
                        Draft — verification required
                      </span>
                    )}
                    <div className="field" style={{ margin: 0, marginBottom: '0.25rem' }}>
                      <label htmlFor={`obl-name-${idx}`} style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                        Name
                      </label>
                      <input
                        id={`obl-name-${idx}`}
                        type="text"
                        value={s.name}
                        onChange={(e) => updateName(idx, e.target.value)}
                        style={{ fontSize: '0.9rem' }}
                      />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label htmlFor={`obl-desc-${idx}`} style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                        Description
                      </label>
                      <textarea
                        id={`obl-desc-${idx}`}
                        value={s.description}
                        onChange={(e) => updateDescription(idx, e.target.value)}
                        style={{ fontSize: '0.85rem', minHeight: '60px' }}
                      />
                    </div>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {checkedCount > 0 && (
            <p style={{ fontSize: '0.85rem', color: '#6c757d' }}>
              {checkedCount} obligation{checkedCount !== 1 ? 's' : ''} selected — these will be saved as drafts pending your verification.
            </p>
          )}
        </div>
      )}

      <button type="submit" disabled={submitting || !selectedCode}>
        Save &amp; Continue
      </button>
    </form>
  )
}
