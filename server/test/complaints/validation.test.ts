import { describe, it, expect } from 'vitest'
import { validateComplaint } from '../../src/modules/complaints/validation.js'

describe('validateComplaint', () => {
  it('accepts a valid complaint and trims description', () => {
    const result = validateComplaint({ description: '  Customer unhappy  ' })
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        description: 'Customer unhappy',
        severity: 'low',
        status: 'new',
      }),
    })
  })

  it('rejects missing description', () => {
    expect(validateComplaint({})).toEqual({ ok: false, errors: { description: 'Required' } })
  })

  it('rejects empty description', () => {
    expect(validateComplaint({ description: '   ' })).toEqual({ ok: false, errors: { description: 'Required' } })
  })

  it('accepts a valid channel', () => {
    const result = validateComplaint({ description: 'Issue', channel: 'email' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.channel).toBe('email')
  })

  it('rejects invalid channel', () => {
    const result = validateComplaint({ description: 'Issue', channel: 'fax' })
    expect(result).toEqual({ ok: false, errors: { channel: 'Invalid channel' } })
  })

  it('defaults severity to low', () => {
    const result = validateComplaint({ description: 'Issue' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.severity).toBe('low')
  })

  it('accepts explicit severity', () => {
    const result = validateComplaint({ description: 'Issue', severity: 'high' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.severity).toBe('high')
  })

  it('defaults status to new', () => {
    const result = validateComplaint({ description: 'Issue' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.status).toBe('new')
  })
})
