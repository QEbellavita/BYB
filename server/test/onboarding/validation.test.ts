import { describe, it, expect } from 'vitest'
import { validateProfile, validateRules, validateIndustry, validatePeople } from '../../src/modules/onboarding/validation.js'
import { obligationSuggestionsFor, ANZSIC_OPTIONS } from '../../src/modules/onboarding/anzsic-catalogue.js'

describe('validateProfile', () => {
  it('trims name and returns ok', () => {
    expect(validateProfile({ name: '  Acme  ', jurisdiction: 'AU', size: 'small', description: '' }))
      .toEqual({ ok: true, value: { name: 'Acme', jurisdiction: 'AU', size: 'small', description: '' } })
  })

  it('rejects empty name', () => {
    const r = validateProfile({ name: '   ', jurisdiction: 'AU', size: 'small', description: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['name']).toBeDefined()
  })

  it('accepts NZ jurisdiction', () => {
    const r = validateProfile({ name: 'Co', jurisdiction: 'NZ', size: 'micro', description: 'desc' })
    expect(r.ok).toBe(true)
  })
})

describe('validateIndustry', () => {
  it('accepts valid code 7000', () => {
    expect(validateIndustry({ anzsicCode: '7000' }).ok).toBe(true)
  })

  it('accepts all catalogue codes', () => {
    for (const { code } of ANZSIC_OPTIONS) {
      expect(validateIndustry({ anzsicCode: code }).ok).toBe(true)
    }
  })

  it('rejects unknown code', () => {
    expect(validateIndustry({ anzsicCode: '9999' })).toEqual({
      ok: false,
      errors: { anzsicCode: 'Select a supported ANZSIC code' },
    })
  })
})

describe('validatePeople', () => {
  it('rejects duplicate emails case-insensitively', () => {
    expect(validatePeople([
      { personName: 'A', email: 'SAME@test.dev', role: 'staff', title: '', responsibilities: [], accessScope: {}, invite: true },
      { personName: 'B', email: 'same@test.dev', role: 'manager', title: '', responsibilities: [], accessScope: {}, invite: true },
    ]).ok).toBe(false)
  })

  it('lowercases emails on success', () => {
    const r = validatePeople([
      { personName: 'Alice', email: 'Alice@Example.com', role: 'owner', title: 'CEO', responsibilities: [], accessScope: {}, invite: false },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0].email).toBe('alice@example.com')
  })

  it('trims personName', () => {
    const r = validatePeople([
      { personName: '  Bob  ', email: 'bob@ex.com', role: 'admin', title: '', responsibilities: [], accessScope: {}, invite: false },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value[0].personName).toBe('Bob')
  })

  it('rejects invalid role', () => {
    const r = validatePeople([
      { personName: 'Eve', email: 'eve@ex.com', role: 'superuser' as never, title: '', responsibilities: [], accessScope: {}, invite: false },
    ])
    expect(r.ok).toBe(false)
  })

  it('accepts all valid roles', () => {
    const roles = ['owner', 'admin', 'manager', 'compliance_officer', 'accountant', 'staff'] as const
    for (const role of roles) {
      const r = validatePeople([
        { personName: 'X', email: `${role}@ex.com`, role, title: '', responsibilities: [], accessScope: {}, invite: false },
      ])
      expect(r.ok).toBe(true)
    }
  })
})

describe('validateRules', () => {
  it('rejects operator without value', () => {
    const r = validateRules([
      { ruleType: 'business_rule', area: 'Finance', statement: 'Do X', operator: '>', value: null, consequence: '', appliesTo: [] },
    ])
    expect(r.ok).toBe(false)
  })

  it('rejects value without operator', () => {
    const r = validateRules([
      { ruleType: 'business_rule', area: 'Finance', statement: 'Do X', operator: null, value: 100, consequence: '', appliesTo: [] },
    ])
    expect(r.ok).toBe(false)
  })

  it('accepts both operator and value set', () => {
    const r = validateRules([
      { ruleType: 'business_rule', area: 'Finance', statement: 'Do X', operator: '>', value: 100, consequence: 'Y', appliesTo: [] },
    ])
    expect(r.ok).toBe(true)
  })

  it('accepts both operator and value null', () => {
    const r = validateRules([
      { ruleType: 'value_setting', area: 'HR', statement: 'Do Y', operator: null, value: null, consequence: 'Z', appliesTo: [] },
    ])
    expect(r.ok).toBe(true)
  })
})

describe('obligationSuggestionsFor', () => {
  it('returns draft suggestions for valid code', () => {
    expect(obligationSuggestionsFor('7000').every(x => x.status === 'draft')).toBe(true)
  })

  it('includes disclaimer in all descriptions', () => {
    const suggestions = obligationSuggestionsFor('7000')
    expect(suggestions.length).toBeGreaterThan(0)
    for (const s of suggestions) {
      expect(s.description).toContain('General setup guidance only—not legal advice. Verify each obligation before activation.')
    }
  })

  it('sets source to custom and subscribe_updates to false', () => {
    const suggestions = obligationSuggestionsFor('6932')
    expect(suggestions.every(s => s.source === 'custom' && s.subscribe_updates === false)).toBe(true)
  })

  it('returns empty array for unknown code', () => {
    expect(obligationSuggestionsFor('9999')).toEqual([])
  })

  it('returns suggestions for all catalogue codes', () => {
    for (const { code } of ANZSIC_OPTIONS) {
      expect(obligationSuggestionsFor(code).length).toBeGreaterThan(0)
    }
  })
})
