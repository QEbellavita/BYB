import type { ValidationResult, ProfileInput, RuleInput, PersonInput } from './types.js'
import { ANZSIC_OPTIONS } from './anzsic-catalogue.js'

const VALID_ANZSIC_CODES: Set<string> = new Set(ANZSIC_OPTIONS.map(o => o.code))

const VALID_ROLES = new Set(['owner', 'admin', 'manager', 'compliance_officer', 'accountant', 'staff'])

export function validateProfile(input: ProfileInput): ValidationResult<ProfileInput> {
  const errors: Record<string, string> = {}

  const name = input.name.trim()
  if (!name) errors['name'] = 'Business name is required'

  if (!input.jurisdiction) errors['jurisdiction'] = 'Jurisdiction is required'

  if (!input.size) errors['size'] = 'Business size is required'

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      name,
      jurisdiction: input.jurisdiction,
      size: input.size.trim(),
      description: input.description.trim(),
    },
  }
}

export function validateRules(inputs: RuleInput[]): ValidationResult<RuleInput[]> {
  const errors: Record<string, string> = {}

  for (let i = 0; i < inputs.length; i++) {
    const r = inputs[i]
    const hasOperator = r.operator !== null && r.operator !== undefined && r.operator !== ''
    const hasValue = r.value !== null && r.value !== undefined && r.value !== ''

    if (hasOperator !== hasValue) {
      errors[`${i}.operator`] = 'Operator and value must both be set or both be empty'
    }

    if (!r.statement.trim()) {
      errors[`${i}.statement`] = 'Statement is required'
    }

    if (!r.area.trim()) {
      errors[`${i}.area`] = 'Area is required'
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: inputs.map(r => ({
      ...r,
      area: r.area.trim(),
      statement: r.statement.trim(),
      consequence: r.consequence.trim(),
    })),
  }
}

export function validateIndustry(input: { anzsicCode: string }): ValidationResult<{ anzsicCode: string }> {
  if (!VALID_ANZSIC_CODES.has(input.anzsicCode)) {
    return { ok: false, errors: { anzsicCode: 'Select a supported ANZSIC code' } }
  }
  return { ok: true, value: { anzsicCode: input.anzsicCode } }
}

export function validatePeople(inputs: PersonInput[]): ValidationResult<PersonInput[]> {
  const errors: Record<string, string> = {}
  const seenEmails = new Set<string>()

  for (let i = 0; i < inputs.length; i++) {
    const p = inputs[i]
    const email = p.email.toLowerCase()

    if (!p.personName.trim()) {
      errors[`${i}.personName`] = 'Person name is required'
    }

    if (!VALID_ROLES.has(p.role)) {
      errors[`${i}.role`] = `Invalid role: ${p.role}`
    }

    if (seenEmails.has(email)) {
      errors[`${i}.email`] = 'Duplicate email address'
    } else {
      seenEmails.add(email)
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: inputs.map(p => ({
      ...p,
      email: p.email.toLowerCase(),
      personName: p.personName.trim(),
      title: p.title.trim(),
    })),
  }
}
