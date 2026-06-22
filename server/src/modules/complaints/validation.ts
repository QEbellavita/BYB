import type { ValidationResult, ComplaintInput, ComplaintStatus, ComplaintChannel, ComplaintSeverity } from './types.js'

const VALID_CHANNELS: ComplaintChannel[] = ['phone', 'email', 'in_person', 'web', 'other']

export function validateComplaint(input: unknown): ValidationResult<ComplaintInput> {
  const raw = input as Record<string, unknown>
  const errors: Record<string, string> = {}

  // Description: required, trim
  const descRaw = typeof raw['description'] === 'string' ? raw['description'] : ''
  const description = descRaw.trim()
  if (!description) errors['description'] = 'Required'

  // Channel: optional, must be in enum if provided
  const channelRaw = raw['channel']
  if (channelRaw !== undefined && channelRaw !== null) {
    if (!VALID_CHANNELS.includes(channelRaw as ComplaintChannel)) {
      errors['channel'] = 'Invalid channel'
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const severity: ComplaintSeverity = (raw['severity'] as ComplaintSeverity | undefined) ?? 'low'
  const status: ComplaintStatus = (raw['status'] as ComplaintStatus | undefined) ?? 'new'

  // Category: optional; trim and coerce empty string to null
  const categoryRaw = raw['category']
  let category: string | null = null
  if (typeof categoryRaw === 'string') {
    const trimmed = categoryRaw.trim()
    category = trimmed.length > 0 ? trimmed : null
  }

  // complainant_name: optional; trim
  const nameRaw = raw['complainant_name']
  const complainant_name: string | null =
    typeof nameRaw === 'string' && nameRaw.trim().length > 0 ? nameRaw.trim() : null

  // complainant_contact: optional; trim
  const contactRaw = raw['complainant_contact']
  const complainant_contact: string | null =
    typeof contactRaw === 'string' && contactRaw.trim().length > 0 ? contactRaw.trim() : null

  return {
    ok: true,
    value: {
      id: raw['id'] as string | undefined,
      version: raw['version'] as number | undefined,
      description,
      channel: channelRaw as ComplaintChannel | undefined,
      severity,
      status,
      category,
      complainant_name,
      complainant_contact,
      assignee_person_id: (raw['assignee_person_id'] as string | undefined) ?? null,
    },
  }
}
