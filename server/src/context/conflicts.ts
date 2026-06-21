import type { SupabaseClient } from '@supabase/supabase-js'

export interface RuleConflict { rule_a: string; rule_b: string; kind: 'duplicate' | 'divergent' }

export async function ruleConflicts(db: SupabaseClient, ws: string): Promise<RuleConflict[]> {
  const { data, error } = await db.rpc('context_rule_conflicts', { ws })
  if (error) throw new Error(`ruleConflicts: ${error.message}`)
  return (data ?? []) as RuleConflict[]
}
