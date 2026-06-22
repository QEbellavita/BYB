import { describe, it, expect } from 'vitest'
import { validateComplaint } from '../src/modules/complaints/validation.js'
import { validateImprovement } from '../src/modules/improvements/validation.js'

// Covers the final-review contract fixes: complaint severity enum validation (I2)
// and improvements `detail` wiring (I3).

describe('complaint severity validation (I2)', () => {
  it('rejects an out-of-enum severity with a field error (400, not a DB 500)', () => {
    expect(validateComplaint({ description: 'x', severity: 'critical' })).toMatchObject({
      ok: false,
      errors: { severity: expect.any(String) },
    })
  })
  it('accepts a valid severity', () => {
    expect(validateComplaint({ description: 'x', severity: 'high' }).ok).toBe(true)
  })
  it('defaults severity to low when absent', () => {
    const r = validateComplaint({ description: 'x' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.severity).toBe('low')
  })
})

describe('improvement detail wiring (I3)', () => {
  it('extracts and trims detail from input', () => {
    const r = validateImprovement({ title: 't', detail: '  some detail  ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.detail).toBe('some detail')
  })
  it('leaves detail undefined when blank', () => {
    const r = validateImprovement({ title: 't', detail: '   ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.detail).toBeUndefined()
  })
})
