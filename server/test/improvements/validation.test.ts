import { describe, it, expect } from 'vitest'
import { validateImprovement } from '../../src/modules/improvements/validation.js'

describe('validateImprovement', () => {
  it('returns error when title is missing', () => {
    const result = validateImprovement({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toMatchObject({ title: 'Title is required' })
    }
  })

  it('returns error when title is blank', () => {
    const result = validateImprovement({ title: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toMatchObject({ title: 'Title is required' })
    }
  })

  it('succeeds with valid title', () => {
    const result = validateImprovement({ title: 'Fix the process' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.title).toBe('Fix the process')
    }
  })

  it('forces source to manual regardless of input', () => {
    const result = validateImprovement({ title: 'Test', source: 'auto' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.source).toBe('manual')
    }
  })

  it('defaults status to open when not provided', () => {
    const result = validateImprovement({ title: 'Test' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('open')
    }
  })

  it('includes suggested_change when provided', () => {
    const result = validateImprovement({ title: 'Test', suggested_change: 'Do X instead of Y' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.suggested_change).toBe('Do X instead of Y')
    }
  })

  it('trims title', () => {
    const result = validateImprovement({ title: '  Trim me  ' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.title).toBe('Trim me')
    }
  })
})
