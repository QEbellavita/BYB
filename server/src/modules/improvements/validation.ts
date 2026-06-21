import type { ValidationResult, ImprovementInput } from './types.js'

export function validateImprovement(input: unknown): ValidationResult<ImprovementInput> {
  const raw = input as Record<string, unknown>
  const errors: Record<string, string> = {}

  // Title: required, trim
  const titleRaw = typeof raw['title'] === 'string' ? raw['title'] : ''
  const title = titleRaw.trim()
  if (!title) errors['title'] = 'Title is required'

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      id: raw['id'] as string | undefined,
      version: raw['version'] as number | undefined,
      title,
      suggested_change: raw['suggested_change'] as string | undefined,
      // source is always forced to 'manual' for the manual create path
      source: 'manual',
      status: (raw['status'] as ImprovementInput['status'] | undefined) ?? 'open',
    },
  }
}
