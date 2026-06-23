import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { loadConfig } from '../../src/config.js'
import { anonClient, serviceClient, userScopedClient } from '../../src/supabase.js'
import { createApp } from '../../src/app.js'

const config = loadConfig()
const ts = Date.now()
const password = 'Test-pass-123456'

const emailAdmin = `audit-admin-${ts}@test.dev`
const emailOther = `audit-other-${ts}@test.dev`

let tokenAdmin: string
let userIdAdmin: string
let workspaceId: string

let tokenOther: string
let userIdOther: string
let workspaceIdOther: string

let app: ReturnType<typeof createApp>

beforeAll(async () => {
  app = createApp(config)
  const admin = serviceClient(config)

  // === Tenant 1: admin user ===
  const { error: err1 } = await admin.auth.admin.createUser({ email: emailAdmin, password, email_confirm: true })
  if (err1) throw new Error(`createUser admin: ${err1.message}`)

  const { data: signIn1, error: signInErr1 } = await anonClient(config).auth.signInWithPassword({ email: emailAdmin, password })
  if (signInErr1 || !signIn1.session) throw new Error(`sign-in admin: ${signInErr1?.message}`)
  tokenAdmin = signIn1.session.access_token
  userIdAdmin = signIn1.session.user.id

  const db1 = userScopedClient(config, tokenAdmin)
  const { data: ws1, error: wsErr1 } = await db1.rpc('create_workspace', { p_name: 'Audit Co', p_slug: `audit-${ts}` })
  if (wsErr1) throw new Error(`create_workspace admin: ${wsErr1.message}`)
  if (!ws1 || typeof ws1 !== 'object' || !('id' in ws1)) throw new Error('no workspace for admin')
  workspaceId = (ws1 as { id: string }).id

  // Insert an audit_log row using the service-role client (simulates a data-change trigger)
  const { error: insertErr } = await admin.from('audit_log').insert({
    workspace_id: workspaceId,
    actor: userIdAdmin,
    actor_email: emailAdmin,
    action: 'risk.created',
    entity_type: 'risk_entry',
    entity_id: null,
    metadata: { test: true },
  })
  if (insertErr) throw new Error(`audit_log insert: ${insertErr.message}`)

  // === Tenant 2: a different user (not a member of workspace 1) ===
  const { error: err2 } = await admin.auth.admin.createUser({ email: emailOther, password, email_confirm: true })
  if (err2) throw new Error(`createUser other: ${err2.message}`)

  const { data: signIn2, error: signInErr2 } = await anonClient(config).auth.signInWithPassword({ email: emailOther, password })
  if (signInErr2 || !signIn2.session) throw new Error(`sign-in other: ${signInErr2?.message}`)
  tokenOther = signIn2.session.access_token
  userIdOther = signIn2.session.user.id

  const db2 = userScopedClient(config, tokenOther)
  const { data: ws2, error: wsErr2 } = await db2.rpc('create_workspace', { p_name: 'Other Co', p_slug: `other-${ts}` })
  if (wsErr2) throw new Error(`create_workspace other: ${wsErr2.message}`)
  if (!ws2 || typeof ws2 !== 'object' || !('id' in ws2)) throw new Error('no workspace for other')
  workspaceIdOther = (ws2 as { id: string }).id
})

afterAll(async () => {
  const admin = serviceClient(config)
  if (workspaceId) await admin.from('workspaces').delete().eq('id', workspaceId)
  if (workspaceIdOther) await admin.from('workspaces').delete().eq('id', workspaceIdOther)
  if (userIdAdmin) await admin.auth.admin.deleteUser(userIdAdmin)
  if (userIdOther) await admin.auth.admin.deleteUser(userIdOther)
})

describe('GET /api/audit (live stack)', () => {
  // NOTE: Password-only sign-in produces an aal1 token. The AAL2 gate now
  // blocks aal1 callers with 403 mfa_required. A full e2e aal2 path (TOTP
  // enrol + verify in-test) is deferred as a follow-up; for now we prove the
  // gate is wired by asserting the aal1 → 403 behaviour on the live stack.

  it('aal1 admin gets 403 mfa_required (AAL2 gate is wired)', async () => {
    // tokenAdmin was obtained via password-only sign-in → aal1 token.
    const res = await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${tokenAdmin}`)
      .set('x-workspace-id', workspaceId)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('mfa_required')
  })

  it('second-tenant user cannot see tenant-1 audit entries (403 — not a workspace member)', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${tokenOther}`)
      .set('x-workspace-id', workspaceId)

    // Other user is not a member of workspace 1 → requireWorkspace returns 403
    expect(res.status).toBe(403)
  })

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('x-workspace-id', workspaceId)

    expect(res.status).toBe(401)
  })

  it('returns 400 without workspace header', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('authorization', `Bearer ${tokenAdmin}`)

    expect(res.status).toBe(400)
  })
})
