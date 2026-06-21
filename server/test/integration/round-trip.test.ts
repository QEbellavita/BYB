import { describe, it, expect, beforeAll } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { anonClient, serviceClient, userScopedClient } from '../../src/supabase.js'
import { supabaseHubStore, supabaseEventStore } from '../../src/context/supabase-store.js'
import { ContextHub } from '../../src/context/index.js'

const config = loadConfig()
const email = `int-${Date.now()}@test.dev`
const password = 'Test-pass-123456'
let token: string
let workspaceId: string

beforeAll(async () => {
  const admin = serviceClient(config)
  await admin.auth.admin.createUser({ email, password, email_confirm: true })
  const { data, error } = await anonClient(config).auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`)
  token = data.session.access_token
  const db = userScopedClient(config, token)
  const { data: ws, error: wErr } = await db.rpc('create_workspace', { p_name: 'Int Co', p_slug: `int-${Date.now()}` })
  if (wErr) throw new Error(`create_workspace failed: ${wErr.message}`)
  workspaceId = (ws as { id: string }).id
})

describe('Context Hub round-trip (live stack)', () => {
  it('upsert writes a row under RLS, the trigger versions it and emits an outbox event', async () => {
    const db = userScopedClient(config, token)
    const store = supabaseHubStore(db)
    const rule = await ContextHub.rules.upsert(store, {
      workspace_id: workspaceId, rule_type: 'must_do', area: 'finance', statement: 'sign off invoices', applies_to: ['manager'],
    })
    expect(rule.version).toBe(1)
    expect(rule.created_by).toBeTruthy()

    const versions = await db.from('entity_versions').select('*').eq('entity_id', rule.id)
    expect(versions.data?.length).toBe(1)

    const events = await supabaseEventStore(db).pending()
    expect(events.some((e) => e.entity_id === rule.id && e.type === 'business_rules.insert')).toBe(true)
  })
})
