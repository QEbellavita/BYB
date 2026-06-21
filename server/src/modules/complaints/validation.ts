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

  return {
    ok: true,
    value: {
      id: raw['id'] as string | undefined,
      version: raw['version'] as number | undefined,
      description,
      channel: channelRaw as ComplaintChannel | undefined,
      severity,
      status,
      customerId: raw['customerId'] as string | undefined,
      notes: raw['notes'] as string | undefined,
    },
  }
}
