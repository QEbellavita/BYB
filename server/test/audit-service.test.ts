import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAuditService } from '../src/services/audit.js'
import type { AuditRecorder } from '../src/services/audit.js'

// Minimal fake SupabaseClient that records calls to from().insert()
function makeFakeDb(insertResult: { error: null | { message: string } } = { error: null }) {
  const insertSpy = vi.fn().mockResolvedValue(insertResult)
  const fromSpy = vi.fn().mockReturnValue({ insert: insertSpy })
  return { db: { from: fromSpy } as any, fromSpy, insertSpy }
}

describe('createAuditService', () => {
  it('inserts one row into audit_log with the mapped columns', async () => {
    const { db, fromSpy, insertSpy } = makeFakeDb()
    const recorder: AuditRecorder = createAuditService(db)

    await recorder.record({
      workspaceId: 'ws-1',
      actor: 'user-1',
      actorEmail: 'user@test.dev',
      action: 'authz.denied',
      entityType: 'workspace',
      entityId: 'entity-1',
      metadata: { ip: '127.0.0.1', route: '/api/test', method: 'GET' },
    })

    expect(fromSpy).toHaveBeenCalledWith('audit_log')
    expect(insertSpy).toHaveBeenCalledWith({
      workspace_id: 'ws-1',
      actor: 'user-1',
      actor_email: 'user@test.dev',
      action: 'authz.denied',
      entity_type: 'workspace',
      entity_id: 'entity-1',
      metadata: { ip: '127.0.0.1', route: '/api/test', method: 'GET' },
    })
  })

  it('maps null/undefined optional fields to null', async () => {
    const { db, insertSpy } = makeFakeDb()
    const recorder = createAuditService(db)

    await recorder.record({ action: 'auth.denied' })

    expect(insertSpy).toHaveBeenCalledWith({
      workspace_id: null,
      actor: null,
      actor_email: null,
      action: 'auth.denied',
      entity_type: null,
      entity_id: null,
      metadata: null,
    })
  })

  it('does NOT throw when the db insert rejects (swallows error)', async () => {
    const insertSpy = vi.fn().mockRejectedValue(new Error('network down'))
    const db = { from: vi.fn().mockReturnValue({ insert: insertSpy }) } as any
    const recorder = createAuditService(db)

    // Must not throw
    await expect(recorder.record({ action: 'auth.denied' })).resolves.toBeUndefined()
  })

  it('does NOT throw when the db returns an error object (logs + swallows)', async () => {
    const { db } = makeFakeDb({ error: { message: 'insert blocked' } })
    const recorder = createAuditService(db)

    await expect(recorder.record({ action: 'auth.denied' })).resolves.toBeUndefined()
  })
})
