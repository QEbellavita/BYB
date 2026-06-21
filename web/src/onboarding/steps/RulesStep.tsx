import { useState } from 'react'
import { RuleEditor } from '../rule-builder/RuleEditor'
import type { onboardingApi } from '../api'
import type { OnboardingSnapshot, RuleInput } from '../types'
import { hasDivergentConflict } from '../conflicts'

interface RulesStepProps {
  token: string
  workspaceId: string | null
  initialRules: RuleInput[]
  api: ReturnType<typeof onboardingApi>
  onSave: (snapshot: OnboardingSnapshot) => void
}

export function RulesStep({ workspaceId: _workspaceId, initialRules, api, onSave }: RulesStepProps) {
  const [rules, setRules] = useState<RuleInput[]>(initialRules)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleAdd(rule: RuleInput) {
    if (editingIdx !== null) {
      // Replace edited rule
      setRules((prev) => prev.map((r, i) => (i === editingIdx ? rule : r)))
      setEditingIdx(null)
    } else {
      setRules((prev) => [...prev, rule])
    }
  }

  function handleArchive(idx: number) {
    setRules((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleEdit(idx: number) {
    setEditingIdx(idx)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const snap = await api.saveRules(rules)
      onSave(snap)
    } catch {
      // keep state on error
    } finally {
      setSubmitting(false)
    }
  }

  const divergent = hasDivergentConflict(rules)

  return (
    <div>
      <h2>How does your business operate?</h2>

      {divergent && (
        <aside role="status" className="divergent-warning">
          Divergent rule: this statement has a different value or consequence for the same audience.
        </aside>
      )}

      {rules.length > 0 && (
        <ul className="rules-list">
          {rules.map((rule, idx) => (
            <li key={idx}>
              <div>
                <strong>{rule.statement}</strong>
                <div>
                  <small>
                    {rule.area} · {rule.ruleType} · {rule.appliesTo.join(', ')}
                  </small>
                </div>
              </div>
              <div className="rule-actions">
                <button type="button" onClick={() => handleEdit(idx)}>
                  Edit
                </button>
                <button type="button" onClick={() => handleArchive(idx)}>
                  Archive
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RuleEditor
        key={editingIdx ?? 'new'}
        initial={editingIdx !== null ? rules[editingIdx] : undefined}
        onAdd={handleAdd}
        submitLabel={editingIdx !== null ? 'Update rule' : 'Add rule'}
      />

      <form onSubmit={handleSave}>
        <button type="submit" disabled={submitting}>
          Save &amp; Continue
        </button>
      </form>
    </div>
  )
}
