export type Severity = 'low' | 'med' | 'high' | 'ext'

export function severityBucket(likelihood: number, impact: number): Severity {
  const s = likelihood * impact
  if (s >= 15) return 'ext'
  if (s >= 12) return 'high'
  if (s >= 6) return 'med'
  return 'low'
}
