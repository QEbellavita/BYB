import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { anonClient, serviceClient, userScopedClient } from '../../src/supabase.js'
import { supabaseHubStore } from '../../src/context/supabase-store.js'
import { supabaseOnboardingCompletionStore } from '../../src/context/onboarding.js'
import { supabaseOnboardingStore } from '../../src/modules/onboarding/supabase-store.js'
import { createOnboardingService } from '../../src/modules/onboarding/service.js'
import { ContextHub } from '../../src/context/index.js'

const config = loadConfig()
const ts = Date.now()
const email1 = `onb-owner-${ts}@test.dev`
const password = 'Test-pass-123456'

// Tenant 1 state
let token1: string
let userId1: string
let workspaceId1: string
let sessionId1: string

// Tenant 2 state (isolation check)
const email2 = `onb-t2-${ts}@test.dev`
let token2: string
let userId2: string
let workspaceId2: string

beforeAll(async () => {
  const admin = serviceClient(config)

  // === Tenant 1 ===
  const { error: err1 } = await admin.auth.admin.createUser({ email: email1, password, email_confirm: true })
  if (err1) throw new Error(`createUser t1: ${err1.message}`)

  const { data: signIn1, error: signInErr1 } = await anonClient(config).auth.signInWithPassword({ email: email1, password })
  if (signInErr1 || !signIn1.session) throw new Error(`sign-in t1: ${signInErr1?.message}`)
  token1 = signIn1.session.access_token
  userId1 = signIn1.session.user.id

  const db1 = userScopedClient(config, token1)
  const { data: ws1, error: wsErr1 } = await db1.rpc('create_workspace', { p_name: 'Onb Co', p_slug: `onb-${ts}` })
  if (wsErr1) throw new Error(`create_workspace t1: ${wsErr1.message}`)
  if (!ws1 || typeof ws1 !== 'object' || !('id' in ws1)) throw new Error('no workspace t1')
  workspaceId1 = (ws1 as { id: string }).id

  // Create onboarding session
  const store1 = supabaseOnboardingStore(db1)
  const session1 = await store1.createSession(workspaceId1, userId1)
  sessionId1 = session1.id

  // === Tenant 2 ===
  const { error: err2 } = await admin.auth.admin.createUser({ email: email2, password, email_confirm: true })
  if (err2) throw new Error(`createUser t2: ${err2.message}`)

  const { data: signIn2, error: signInErr2 } = await anonClient(config).auth.signInWithPassword({ email: email2, password })
  if (signInErr2 || !signIn2.session) throw new Error(`sign-in t2: ${signInErr2?.message}`)
  token2 = signIn2.session.access_token
  userId2 = signIn2.session.user.id

  const db2 = userScopedClient(config, token2)
  const { data: ws2, error: wsErr2 } = await db2.rpc('create_workspace', { p_name: 'Onb Co 2', p_slug: `onb2-${ts}` })
  if (wsErr2) throw new Error(`create_workspace t2: ${wsErr2.message}`)
  if (!ws2 || typeof ws2 !== 'object' || !('id' in ws2)) throw new Error('no workspace t2')
  workspaceId2 = (ws2 as { id: string }).id
})

afterAll(async () => {
  const admin = serviceClient(config)
  if (workspaceId1) await admin.from('workspaces').delete().eq('id', workspaceId1)
  if (workspaceId2) await admin.from('workspaces').delete().eq('id', workspaceId2)
  if (userId1) await admin.auth.admin.deleteUser(userId1)
  if (userId2) await admin.auth.admin.deleteUser(userId2)
})

describe('Onboarding complete flow (live stack)', () => {
  it('saves all 4 steps and finish activates all entities + creates invite row', async () => {
    const db = userScopedClient(config, token1)
    const hubStore = supabaseHubStore(db)
    const onboardingStore = supabaseOnboardingStore(db)
    const completionStore = supabaseOnboardingCompletionStore(db)

    // No-op email transport — invite rows must still be created by RPC
    const sendInvite = async (_args: { email: string; token: string; workspaceId: string }) => {
      // intentional no-op
    }

    const svc = createOnboardingService({
      hub: ContextHub as any,
      hubStore,
      onboardingStore,
      completionStore,
      sendInvite,
    })

    const ctx = { workspaceId: workspaceId1, userId: userId1, sessionId: sessionId1 }

    // Step 1: Profile
    await svc.saveProfile(ctx, {
      name: 'Integration Corp',
      jurisdiction: 'AU',
      size: 'small',
      description: 'A test company for integration testing',
    })

    // Step 2: Rules (≥2 rules)
    await svc.saveRules(ctx, [
      {
        ruleType: 'business_rule',
        area: 'Finance',
        statement: 'All invoices must be signed off by a manager',
        operator: null,
        value: null,
        consequence: 'Invoice rejected',
        appliesTo: ['manager'],
      },
      {
        ruleType: 'must_do',
        area: 'HR',
        statement: 'All staff must complete onboarding training',
        operator: null,
        value: null,
        consequence: 'Access revoked',
        appliesTo: ['staff'],
      },
    ])

    // Step 3: Industry (≥1 obligation)
    await svc.saveIndustry(ctx, {
      anzsicCode: '7000',
      obligations: [
        {
          name: 'Fair Work Act Compliance',
          description: 'Must comply with Fair Work Act requirements',
        },
      ],
    })

    // Step 4: People (≥1 invited person)
    await svc.savePeople(ctx, [
      {
        personName: 'Bob Smith',
        title: 'Operations Manager',
        email: 'bob@integration-corp.test',
        responsibilities: ['day-to-day operations'],
        role: 'manager',
        accessScope: { modules: ['operations'] },
        invite: true,
      },
    ])

    // Finish
    const result = await svc.finish(ctx)
    expect(result.workspaceId).toBe(workspaceId1)
    expect(result.invitesSent).toBe(1)
    expect(result.invitesFailed).toBe(0)

    // --- Assertions using service client (bypasses RLS) ---
    const admin = serviceClient(config)

    // business_profile status 'active'
    const { data: profiles } = await admin
      .from('business_profile')
      .select('*')
      .eq('workspace_id', workspaceId1)
      .eq('status', 'active')
    expect(profiles).toHaveLength(1)

    // all business_rules 'active'
    const { data: rules } = await admin
      .from('business_rules')
      .select('*')
      .eq('workspace_id', workspaceId1)
    expect(rules?.length).toBeGreaterThanOrEqual(2)
    expect(rules?.every(r => r.status === 'active')).toBe(true)

    // all org_people 'active'
    const { data: people } = await admin
      .from('org_people')
      .select('*')
      .eq('workspace_id', workspaceId1)
    expect(people?.length).toBeGreaterThanOrEqual(1)
    expect(people?.every(p => p.status === 'active')).toBe(true)

    // all compliance_obligations 'draft'
    const { data: obligations } = await admin
      .from('compliance_obligations')
      .select('*')
      .eq('workspace_id', workspaceId1)
    expect(obligations?.length).toBeGreaterThanOrEqual(1)
    expect(obligations?.every(o => o.status === 'draft')).toBe(true)

    // exactly 1 workspace_invites row
    const { data: invites } = await admin
      .from('workspace_invites')
      .select('*')
      .eq('workspace_id', workspaceId1)
    expect(invites).toHaveLength(1)

    // onboarding session status 'completed'
    const { data: sessions } = await admin
      .from('onboarding_sessions')
      .select('*')
      .eq('id', sessionId1)
    expect(sessions?.[0]?.status).toBe('completed')

    // invited person's onboarding_invite_draft ended 'sent'
    const { data: drafts } = await admin
      .from('onboarding_invite_drafts')
      .select('*')
      .eq('session_id', sessionId1)
    expect(drafts?.length).toBeGreaterThanOrEqual(1)
    expect(drafts?.every(d => d.status === 'sent')).toBe(true)

    // token available via listInviteDrafts (proving the join)
    const liveDrafts = await onboardingStore.listInviteDrafts(sessionId1)
    expect(liveDrafts.length).toBeGreaterThanOrEqual(1)
    expect(liveDrafts[0].token).toBeTruthy()
  })

  it('cross-tenant isolation: tenant 2 cannot select tenant 1 rows', async () => {
    const db2 = userScopedClient(config, token2)

    // tenant 2 cannot see tenant 1's onboarding session
    const { data: sessions } = await db2
      .from('onboarding_sessions')
      .select('*')
      .eq('workspace_id', workspaceId1)
    expect(sessions ?? []).toHaveLength(0)

    // tenant 2 cannot see tenant 1's invite drafts
    const { data: drafts } = await db2
      .from('onboarding_invite_drafts')
      .select('*')
      .eq('session_id', sessionId1)
    expect(drafts ?? []).toHaveLength(0)

    // tenant 2 cannot see tenant 1's business_profile
    const { data: profiles } = await db2
      .from('business_profile')
      .select('*')
      .eq('workspace_id', workspaceId1)
    expect(profiles ?? []).toHaveLength(0)
  })
})
