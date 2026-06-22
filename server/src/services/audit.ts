import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuditEvent {
  workspaceId?: string | null
  actor?: string | null
  actorEmail?: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown> | null
}

export interface AuditRecorder {
  record(e: AuditEvent): Promise<void>
}

export function createAuditService(db: SupabaseClient): AuditRecorder {
  return {
    async record(e: AuditEvent): Promise<void> {
      try {
        const { error } = await db.from('audit_log').insert({
          workspace_id: e.workspaceId ?? null,
          actor: e.actor ?? null,
          actor_email: e.actorEmail ?? null,
          action: e.action,
          entity_type: e.entityType ?? null,
          entity_id: e.entityId ?? null,
          metadata: e.metadata ?? null,
        })
        if (error) console.error('[audit] insert failed:', error.message)
      } catch (err) {
        console.error('[audit] insert threw:', err)
      }
    },
  }
}
