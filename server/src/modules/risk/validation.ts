import type { ValidationResult, RiskInput, RiskStatus } from './types.js'

export function validateRisk(input: unknown): ValidationResult<RiskInput> {
  const raw = input as Record<string, unknown>
  const errors: Record<string, string> = {}

  // Title: required, trim
  const titleRaw = typeof raw['title'] === 'string' ? raw['title'] : ''
  const title = titleRaw.trim()
  if (!title) errors['title'] = 'Title is required'

  // Likelihood: integer 1-5
  const likelihood = raw['likelihood'] as number
  if (!Number.isInteger(likelihood) || likelihood < 1 || likelihood > 5) {
    errors['likelihood'] = 'Must be 1–5'
  }

  // Impact: integer 1-5
  const impact = raw['impact'] as number
  if (!Number.isInteger(impact) || impact < 1 || impact > 5) {
    errors['impact'] = 'Must be 1–5'
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const status: RiskStatus = (raw['status'] as RiskStatus | undefined) ?? 'open'

  return {
    ok: true,
    value: {
      id: raw['id'] as string | undefined,
      version: raw['version'] as number | undefined,
      title,
      description: raw['description'] as string | undefined,
      category: raw['category'] as string | undefined,
      likelihood,
      impact,
      ownerPersonId: raw['ownerPersonId'] as string | undefined,
      treatment: raw['treatment'] as string | undefined,
      status,
      reviewDate: raw['reviewDate'] as string | undefined,
      frameworkId: raw['frameworkId'] as string | undefined,
    },
  }
}
