/**
 * SP-3 live integration test: risk, complaints, improvements + improvement subscriber
 *
 * Wires the REAL agent flow:
 *   registry → registerImprovementSubscriber → riskStore / complaintStore / improvementStore
 *   publish = makePublish(serviceDb, eventStore, registry)
 *   services constructed with the shared publish + service-role stores
 *
 * Asserts:
 *   1. recurring_complaints dedup
 *   2. untreated_high_risk + clearAuto when treatment added
 *   3. cross-tenant isolation (tenant 2 JWT-scoped client sees zero of tenant 1)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadConfig } from '../../src/config.js'
import { anonClient, serviceClient, userScopedClient } from '../../src/supabase.js'
import { createRegistry } from '../../src/context/events.js'
import { supabaseEventStore } from '../../src/context/supabase-store.js'
import { makePublish } from '../../src/events/publish.js'
import { links } from '../../src/context/links.js'
import { supabaseLinkStore } from '../../src/context/supabase-store.js'
import { supabaseRiskStore } from '../../src/modules/risk/supabase-store.js'
import { createRiskService } from '../../src/modules/risk/service.js'
import { supabaseComplaintsStore } from '../../src/modules/complaints/supabase-store.js'
import { createComplaintsService } from '../../src/modules/complaints/service.js'
import { supabaseImprovementsStore } from '../../src/modules/improvements/supabase-store.js'
import { registerImprovementSubscriber } from '../../src/modules/improvements/subscriber.js'

// ---- Config + shared clients ----
const config = loadConfig()
const ts = Date.now()
const password = 'Test-pass-123456'

// ---- Tenant 1 state ----
const email1 = `sp3-t1-${ts}@test.dev`
let token1: string
let userId1: string
let workspaceId1: string

// ---- Tenant 2 state ----
const email2 = `sp3-t2-${ts}@test.dev`
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
  const { data: ws1, error: wsErr1 } = await db1.rpc('create_workspace', { p_name: 'SP3 Co T1', p_slug: `sp3-t1-${ts}` })
  if (wsErr1) throw new Error(`create_workspace t1: ${wsErr1.message}`)
  if (!ws1 || typeof ws1 !== 'object' || !('id' in ws1)) throw new Error('no workspace t1')
  workspaceId1 = (ws1 as { id: string }).id

  // === Tenant 2 ===
  const { error: err2 } = await admin.auth.admin.createUser({ email: email2, password, email_confirm: true })
  if (err2) throw new Error(`createUser t2: ${err2.message}`)

  const { data: signIn2, error: signInErr2 } = await anonClient(config).auth.signInWithPassword({ email: email2, password })
  if (signInErr2 || !signIn2.session) throw new Error(`sign-in t2: ${signInErr2?.message}`)
  token2 = signIn2.session.access_token
  userId2 = signIn2.session.user.id

  const db2 = userScopedClient(config, token2)
  const { data: ws2, error: wsErr2 } = await db2.rpc('create_workspace', { p_name: 'SP3 Co T2', p_slug: `sp3-t2-${ts}` })
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

/**
 * Build a fully-wired agent stack against the real Supabase service-role client.
 * Returns services ready for use in tests.
 */
function buildStack() {
  const service = serviceClient(config)

  const registry = createRegistry()
  const eventStore = supabaseEventStore(service)
  const publish = makePublish(service, eventStore, registry)
  const linkStore = supabaseLinkStore(service)

  const riskStore = supabaseRiskStore(service)
  const riskService = createRiskService({ store: riskStore, publish, links, linkStore })

  const complaintStore = supabaseComplaintsStore(service)
  const complaintsService = createComplaintsService({ store: complaintStore, publish, links, linkStore })

  const improvementStore = supabaseImprovementsStore(service)

  // Wire the improvement subscriber (same as app.ts)
  registerImprovementSubscriber(
    registry,
    { riskStore, complaintStore, improvementStore },
    () => new Date(),
  )

  return { riskService, complaintsService, improvementStore, service }
}

// ---- Helper: ctx shorthand ----
const ctx1 = () => ({ workspaceId: workspaceId1, userId: userId1 })
const ctx2 = () => ({ workspaceId: workspaceId2, userId: userId2 })

describe('SP-3 modules: live integration (real Supabase)', () => {

  describe('recurring_complaints dedup', () => {
    it('creates an improvements row after 3 billing complaints', async () => {
      const { complaintsService, improvementStore } = buildStack()
      const ctx = ctx1()

      // Create 3 complaints with category='billing'
      for (let i = 0; i < 3; i++) {
        await complaintsService.create(ctx, {
          description: `Billing issue ${i + 1}`,
          category: 'billing',
          severity: 'medium',
        })
      }

      // After the 3rd complaint, subscriber should fire and upsert an improvement
      const rows = await improvementStore.list(ctx.workspaceId)
      const suggestion = rows.find(
        (r) => r.trigger_kind === 'recurring_complaints' && r.dedup_key === 'recurring_complaints:billing',
      )

      expect(suggestion).toBeDefined()
      expect(suggestion?.status).toBe('open')
      expect(suggestion?.source).toBe('auto')
    })

    it('dedup: creating a 4th same-category complaint does NOT create a second open suggestion', async () => {
      const { complaintsService, improvementStore } = buildStack()
      const ctx = ctx1()

      // Create 4th billing complaint
      await complaintsService.create(ctx, {
        description: 'Billing issue 4',
        category: 'billing',
        severity: 'medium',
      })

      // Still exactly ONE open recurring_complaints:billing suggestion
      const rows = await improvementStore.list(ctx.workspaceId)
      const openBillingSuggestions = rows.filter(
        (r) =>
          r.trigger_kind === 'recurring_complaints' &&
          r.dedup_key === 'recurring_complaints:billing' &&
          r.status === 'open',
      )

      expect(openBillingSuggestions).toHaveLength(1)
    })
  })

  describe('untreated_high_risk', () => {
    it('creates an untreated_high_risk improvement for a high-severity open risk without treatment', async () => {
      const { riskService, improvementStore } = buildStack()
      const ctx = ctx1()

      // likelihood × impact = 4 × 3 = 12 (meets HIGH_SEVERITY_MIN)
      const risk = await riskService.create(ctx, {
        title: 'Critical Infrastructure Risk',
        likelihood: 4,
        impact: 3,
        // no treatment
      })

      const rows = await improvementStore.list(ctx.workspaceId)
      const suggestion = rows.find(
        (r) =>
          r.trigger_kind === 'untreated_high_risk' &&
          r.dedup_key === `untreated_high_risk:${risk.id}`,
      )

      expect(suggestion).toBeDefined()
      expect(suggestion?.status).toBe('open')
      expect(suggestion?.source).toBe('auto')

      // Store risk ID for next test in describe scope via returned value
      return risk.id
    })

    it('clearAuto fires when treatment is added: suggestion becomes done', async () => {
      const { riskService, improvementStore } = buildStack()
      const ctx = ctx1()

      // Re-create a risk without treatment (we can't rely on previous test's ID cross-describe easily)
      const risk = await riskService.create(ctx, {
        title: 'Another High Risk for clearAuto test',
        likelihood: 4,
        impact: 3,
        // no treatment
      })

      // Verify the suggestion exists open
      const beforeRows = await improvementStore.list(ctx.workspaceId)
      const beforeSuggestion = beforeRows.find(
        (r) =>
          r.trigger_kind === 'untreated_high_risk' &&
          r.dedup_key === `untreated_high_risk:${risk.id}` &&
          r.status === 'open',
      )
      expect(beforeSuggestion).toBeDefined()

      // Now add a treatment (version check: risk.version = 1)
      await riskService.update(ctx, risk.id, {
        title: risk.title,
        likelihood: risk.likelihood,
        impact: risk.impact,
        treatment: 'Implemented firewall and intrusion detection',
        version: risk.version,
      })

      // After update, the suggestion should be 'done'
      const afterRows = await improvementStore.list(ctx.workspaceId)
      const afterSuggestion = afterRows.find(
        (r) =>
          r.trigger_kind === 'untreated_high_risk' &&
          r.dedup_key === `untreated_high_risk:${risk.id}`,
      )

      expect(afterSuggestion).toBeDefined()
      expect(afterSuggestion?.status).toBe('done')
    })
  })

  describe('cross-tenant isolation', () => {
    it('tenant 2 JWT-scoped client sees ZERO of tenant 1 risks', async () => {
      const db2 = userScopedClient(config, token2)
      const { data: risks } = await db2.from('risk_entries').select('*').eq('workspace_id', workspaceId1)
      expect(risks ?? []).toHaveLength(0)
    })

    it('tenant 2 JWT-scoped client sees ZERO of tenant 1 complaints', async () => {
      const db2 = userScopedClient(config, token2)
      const { data: complaints } = await db2.from('complaints').select('*').eq('workspace_id', workspaceId1)
      expect(complaints ?? []).toHaveLength(0)
    })

    it('tenant 2 JWT-scoped client sees ZERO of tenant 1 improvements', async () => {
      const db2 = userScopedClient(config, token2)
      const { data: improvements } = await db2.from('improvements').select('*').eq('workspace_id', workspaceId1)
      expect(improvements ?? []).toHaveLength(0)
    })

    it('tenant 2 can create and see their OWN risks', async () => {
      const { riskService } = buildStack()
      const ctx = ctx2()

      const risk = await riskService.create(ctx, {
        title: 'Tenant 2 Risk',
        likelihood: 2,
        impact: 2,
      })

      // Tenant 2 scoped client can see their own risk
      const db2 = userScopedClient(config, token2)
      const { data: risks } = await db2.from('risk_entries').select('*').eq('workspace_id', workspaceId2)
      const found = (risks ?? []).find((r: { id: string }) => r.id === risk.id)
      expect(found).toBeDefined()
    })

    // ---- Write-denial assertions (Task 4) ----

    it('tenant 2 CANNOT INSERT a risk_entries row into tenant 1 workspace', async () => {
      const db2 = userScopedClient(config, token2)

      const { error, data } = await db2.from('risk_entries').insert({
        workspace_id: workspaceId1,
        title: 'Tenant 2 cross-tenant attack',
        likelihood: 1,
        impact: 1,
      })

      // RLS with-check should block the insert — error returned or no rows inserted
      const rowsInserted = Array.isArray(data) ? data.length : data ? 1 : 0
      expect(
        error !== null || rowsInserted === 0,
        `Expected cross-tenant risk insert to be denied but got data: ${JSON.stringify(data)}, error: ${JSON.stringify(error)}`,
      ).toBe(true)

      // Confirm tenant 1 data is unaffected: only the rows created by the test suite exist
      const db1 = userScopedClient(config, token1)
      const { data: t1Risks } = await db1.from('risk_entries').select('id, title').eq('workspace_id', workspaceId1)
      const rogue = (t1Risks ?? []).find((r: { title: string }) => r.title === 'Tenant 2 cross-tenant attack')
      expect(rogue, 'Cross-tenant risk row must NOT appear in tenant 1 data').toBeUndefined()
    })

    it('tenant 2 CANNOT UPDATE a risk_entries row belonging to tenant 1', async () => {
      // First create a risk as tenant 1 (service client) to target
      const admin = serviceClient(config)
      const { data: inserted } = await admin.from('risk_entries').insert({
        workspace_id: workspaceId1,
        title: 'T1 Risk for update-denial test',
        likelihood: 2,
        impact: 2,
      }).select('id').single()
      if (!inserted) throw new Error('Could not seed T1 risk for update-denial test')

      const db2 = userScopedClient(config, token2)
      const { error, count } = await db2
        .from('risk_entries')
        .update({ title: 'HACKED by tenant 2' })
        .eq('id', inserted.id)
        .eq('workspace_id', workspaceId1)

      // RLS USING clause means tenant 2 sees zero matching rows → count = 0 (no error, just silently skipped)
      // Either an error or zero rows affected is acceptable proof of denial
      expect(
        error !== null || (count ?? 0) === 0,
        `Expected cross-tenant risk update to be denied but count=${count}, error: ${JSON.stringify(error)}`,
      ).toBe(true)

      // Verify tenant 1's row is unchanged
      const db1 = userScopedClient(config, token1)
      const { data: row } = await db1.from('risk_entries').select('title').eq('id', inserted.id).single()
      expect(row?.title).toBe('T1 Risk for update-denial test')
    })

    it('tenant 2 CANNOT INSERT a complaints row into tenant 1 workspace', async () => {
      const db2 = userScopedClient(config, token2)

      const { error, data } = await db2.from('complaints').insert({
        workspace_id: workspaceId1,
        reference: `CROSS-TENANT-${ts}`,
        description: 'Cross-tenant complaint attack',
        severity: 'high',
      })

      const rowsInserted = Array.isArray(data) ? data.length : data ? 1 : 0
      expect(
        error !== null || rowsInserted === 0,
        `Expected cross-tenant complaint insert to be denied but got data: ${JSON.stringify(data)}, error: ${JSON.stringify(error)}`,
      ).toBe(true)

      // Confirm tenant 1 data is unaffected
      const db1 = userScopedClient(config, token1)
      const { data: t1Complaints } = await db1.from('complaints').select('reference').eq('workspace_id', workspaceId1)
      const rogue = (t1Complaints ?? []).find((r: { reference: string }) => r.reference === `CROSS-TENANT-${ts}`)
      expect(rogue, 'Cross-tenant complaint row must NOT appear in tenant 1 data').toBeUndefined()
    })

    it('tenant 2 CANNOT UPDATE a complaints row belonging to tenant 1', async () => {
      // Seed a complaints row as tenant 1 via service client
      const admin = serviceClient(config)
      const { data: inserted } = await admin.from('complaints').insert({
        workspace_id: workspaceId1,
        reference: `T1-COMPLAINT-${ts}`,
        description: 'Legitimate T1 complaint for update-denial test',
        severity: 'low',
      }).select('id').single()
      if (!inserted) throw new Error('Could not seed T1 complaint for update-denial test')

      const db2 = userScopedClient(config, token2)
      const { error, count } = await db2
        .from('complaints')
        .update({ description: 'HACKED by tenant 2' })
        .eq('id', inserted.id)
        .eq('workspace_id', workspaceId1)

      expect(
        error !== null || (count ?? 0) === 0,
        `Expected cross-tenant complaint update to be denied but count=${count}, error: ${JSON.stringify(error)}`,
      ).toBe(true)

      // Verify tenant 1's row is unchanged
      const db1 = userScopedClient(config, token1)
      const { data: row } = await db1.from('complaints').select('description').eq('id', inserted.id).single()
      expect(row?.description).toBe('Legitimate T1 complaint for update-denial test')
    })
  })
})
