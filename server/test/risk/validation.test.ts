import { describe, it, expect } from 'vitest'
import { validateRisk } from '../../src/modules/risk/validation.js'
describe('validateRisk', () => {
  it('accepts a valid risk and trims title', () => {
    expect(validateRisk({ title: '  Fire  ', likelihood: 3, impact: 4 }))
      .toEqual({ ok: true, value: expect.objectContaining({ title: 'Fire', likelihood: 3, impact: 4, status: 'open' }) })
  })
  it('rejects out-of-range likelihood', () => {
    expect(validateRisk({ title: 'X', likelihood: 9, impact: 2 }))
      .toEqual({ ok: false, errors: { likelihood: 'Must be 1–5' } })
  })
  it('rejects empty title', () => {
    expect(validateRisk({ title: '  ', likelihood: 1, impact: 1 }).ok).toBe(false)
  })
})
