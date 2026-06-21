import { useState } from 'react'
import type { RuleInput } from '../types'

interface RuleEditorProps {
  initial?: Partial<RuleInput>
  onAdd: (rule: RuleInput) => void
  submitLabel?: string
}

const EMPTY: RuleInput = {
  ruleType: 'business_rule',
  area: '',
  statement: '',
  operator: null,
  value: '',
  consequence: '',
  appliesTo: [],
}

export function RuleEditor({ initial, onAdd, submitLabel = 'Add rule' }: RuleEditorProps) {
  const [ruleType, setRuleType] = useState<RuleInput['ruleType']>(
    initial?.ruleType ?? EMPTY.ruleType,
  )
  const [area, setArea] = useState(initial?.area ?? EMPTY.area)
  const [statement, setStatement] = useState(initial?.statement ?? EMPTY.statement)
  const [operator, setOperator] = useState(initial?.operator ?? '')
  const [value, setValue] = useState(String(initial?.value ?? ''))
  const [consequence, setConsequence] = useState(initial?.consequence ?? EMPTY.consequence)
  const [appliesToRaw, setAppliesToRaw] = useState(
    (initial?.appliesTo ?? []).join(', '),
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const rule: RuleInput = {
      ruleType,
      area,
      statement,
      operator: operator.trim() || null,
      value,
      consequence,
      appliesTo: appliesToRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
    onAdd(rule)
  }

  return (
    <form className="step-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="rule-type">Rule Type</label>
        <select
          id="rule-type"
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value as RuleInput['ruleType'])}
        >
          <option value="business_rule">Business Rule</option>
          <option value="value_setting">Value Setting</option>
          <option value="must_do">Must Do</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="rule-area">Area</label>
        <input
          id="rule-area"
          type="text"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="rule-statement">Statement</label>
        <input
          id="rule-statement"
          type="text"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="rule-operator">Operator</label>
        <input
          id="rule-operator"
          type="text"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="rule-value">Value</label>
        <input
          id="rule-value"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="rule-consequence">Consequence</label>
        <input
          id="rule-consequence"
          type="text"
          value={consequence}
          onChange={(e) => setConsequence(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="rule-applies-to">Applies To</label>
        <input
          id="rule-applies-to"
          type="text"
          value={appliesToRaw}
          onChange={(e) => setAppliesToRaw(e.target.value)}
          placeholder="comma-separated"
        />
      </div>

      <button type="submit">{submitLabel}</button>
    </form>
  )
}
