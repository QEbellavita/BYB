import type { RuleInput } from './types'

/** Normalize a string for conflict comparison */
export function normalize(s: string) {
  return s.toLowerCase().trim()
}

/** Check if two appliesTo arrays have any overlap */
export function hasOverlap(a: string[], b: string[]) {
  return a.some((x) => b.some((y) => normalize(x) === normalize(y)))
}

/** Returns true if any two visible rules are divergent:
 *  same area, same normalized statement, overlapping appliesTo, different value OR consequence */
export function hasDivergentConflict(rules: RuleInput[]): boolean {
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]
      const b = rules[j]
      if (
        normalize(a.area) === normalize(b.area) &&
        normalize(a.statement) === normalize(b.statement) &&
        hasOverlap(a.appliesTo, b.appliesTo) &&
        (String(a.value) !== String(b.value) || a.consequence !== b.consequence)
      ) {
        return true
      }
    }
  }
  return false
}
