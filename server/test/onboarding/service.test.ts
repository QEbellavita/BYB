import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOnboardingService, StaleDraftError } from '../../src/modules/onboarding/service.js'
import type {
  OnboardingStore,
  OnboardingSession,
  InviteDraft,
  OnboardingContext,
} from '../../src/modules/onboarding/types.js'
import type { HubStore, HubRow } from '../../src/context/types.js'
import type { CompletionStore, CompletionResult } from '../../src/context/onboarding.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: 'sess-1',
    workspace_id: 'ws-1',
    user_id: 'user-1',
    current_step: 'profile',
    completed_steps: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeHubRow(overrides: Partial<HubRow> = {}): HubRow {
  return {
    id: 'row-1',
    workspace_id: 'ws-1',
    version: 1,
    status: 'draft',
    created_by: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_by: null,
    updated_at: '2024-01-01T00:00:00Z',
    approved_by: null,
    approved_at: null,
    supersedes: null,
    ...overrides,
  }
}

function makeInviteDraft(overrides: Partial<InviteDraft> = {}): InviteDraft {
  return {
    id: 'inv-1',
    session_id: 'sess-1',
    workspace_id: 'ws-1',
    org_person_id: 'person-1',
    email: 'alice@example.com',
    role: 'staff',
    status: 'committed',
    invite_id: null,
    token: 'tok-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type HubCall = [string, string, Record<string, unknown>]

function makeFakeHubStore(seededRows: Record<string, HubRow> = {}): HubStore & { calls: HubCall[] } {
  const calls: HubCall[] = []
  const rows: Record<string, HubRow> = { ...seededRows }
  let idCounter = 100

  return {
    calls,
    async insert(table, row) {
      const id = `gen-${++idCounter}`
      const newRow = makeHubRow({ id, workspace_id: row.workspace_id as string, ...row })
      rows[id] = newRow
      calls.push(['insert', table, row])
      return newRow
    },
    async update(table, id, patch) {
      const existing = rows[id] ?? makeHubRow({ id })
      const updated = { ...existing, ...patch, id, version: existing.version + 1 }
      rows[id] = updated
      calls.push(['update', table, { id, ...patch }])
      return updated
    },
    async getById(table, id) {
      calls.push(['getById', table, { id }])
      return rows[id] ?? null
    },
    async select(table, filters) {
      calls.push(['select', table, filters])
      return Object.values(rows).filter(r => {
        return Object.entries(filters).every(([k, v]) => r[k] === v)
      })
    },
  }
}

function makeFakeOnboardingStore(session: OnboardingSession): OnboardingStore & {
  progressCalls: Array<[string, string, string[]]>
} {
  const progressCalls: Array<[string, string, string[]]> = []
  let currentSession = session
  const inviteDrafts: InviteDraft[] = []

  return {
    progressCalls,
    async createSession(workspaceId, userId) {
      return makeSession({ workspace_id: workspaceId, user_id: userId })
    },
    async getSession(_workspaceId) {
      return currentSession
    },
    async updateProgress(sessionId, currentStep, completedSteps) {
      progressCalls.push([sessionId, currentStep, completedSteps as string[]])
      currentSession = { ...currentSession, current_step: currentStep, completed_steps: completedSteps }
      return currentSession
    },
    async listInviteDrafts(_sessionId) {
      return [...inviteDrafts]
    },
    async reconcileInviteDrafts(sessionId, workspaceId, rows) {
      const drafts = rows.map((r, i) =>
        makeInviteDraft({
          id: `inv-${i + 1}`,
          session_id: sessionId,
          workspace_id: workspaceId,
          org_person_id: r.org_person_id,
          email: r.email,
          role: r.role,
          status: 'queued',
          invite_id: null,
        })
      )
      inviteDrafts.splice(0, inviteDrafts.length, ...drafts)
      return drafts
    },
    async markInviteDelivery(_id, _status) {
      // no-op in fake
    },
  }
}

function makeFakeCompletionStore(result: CompletionResult): CompletionStore & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async complete(sessionId) {
      calls.push(sessionId)
      return result
    },
  }
}

// Minimal hub that matches ContextHub shape used by service
function makeFakeHub(hubStore: HubStore) {
  // We return the actual ContextHub-compatible shape with faked repositories
  const makeRepo = (table: string) => ({
    list: (store: HubStore, workspaceId: string, filters: Record<string, unknown> = {}) =>
      store.select(table, { workspace_id: workspaceId, ...filters }),
    get: (store: HubStore, id: string) => store.getById(table, id),
    upsert: (store: HubStore, input: Record<string, unknown> & { id?: string }) => {
      const { id, ...rest } = input
      return id ? store.update(table, id, rest) : store.insert(table, rest)
    },
    approve: (store: HubStore, id: string) => store.update(table, id, { status: 'active' }),
    deprecate: (store: HubStore, id: string) => store.update(table, id, { status: 'archived' }),
  })

  return {
    profile: makeRepo('business_profile'),
    rules: { ...makeRepo('business_rules'), conflicts: async () => [] },
    obligations: makeRepo('compliance_obligations'),
    people: makeRepo('org_people'),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ctx: OnboardingContext = {
  workspaceId: 'ws-1',
  userId: 'user-1',
  sessionId: 'sess-1',
}

describe('OnboardingService.saveProfile', () => {
  it('validates, upserts profile draft and advances session progress', async () => {
    const session = makeSession()
    const hubStore = makeFakeHubStore()
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    const snap = await svc.saveProfile(ctx, {
      name: 'Acme Corp',
      jurisdiction: 'AU',
      size: 'small',
      description: 'A company',
    })

    // hub insert called for profile
    const insertCall = hubStore.calls.find(([op, table]) => op === 'insert' && table === 'business_profile')
    expect(insertCall).toBeDefined()
    expect(insertCall![2]).toMatchObject({ name: 'Acme Corp', jurisdiction: 'AU' })

    // session progress advanced
    expect(onboardingStore.progressCalls).toHaveLength(1)
    const [sid, step, completed] = onboardingStore.progressCalls[0]
    expect(sid).toBe('sess-1')
    expect(step).toBe('rules')
    expect(completed).toContain('profile')

    expect(snap.session.current_step).toBe('rules')
  })
})

describe('OnboardingService.saveRules', () => {
  it('inserts new rules, updates existing, archives omitted', async () => {
    // Seed an existing rule in the hub
    const existingRule = makeHubRow({ id: 'rule-existing', workspace_id: 'ws-1', version: 1, status: 'draft' })
    const omittedRule = makeHubRow({ id: 'rule-omit', workspace_id: 'ws-1', version: 1, status: 'draft' })

    const hubStore = makeFakeHubStore({ 'rule-existing': existingRule, 'rule-omit': omittedRule })
    // seed select to return both rules for workspace
    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_rules' && filters.workspace_id === 'ws-1') {
        hubStore.calls.push(['select', table, filters])
        return [existingRule, omittedRule]
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    await svc.saveRules(ctx, [
      // existing rule being updated (same version)
      {
        id: 'rule-existing',
        version: 1,
        ruleType: 'business_rule',
        area: 'Finance',
        statement: 'Updated statement',
        operator: null,
        value: null,
        consequence: '',
        appliesTo: [],
      },
      // new rule (no id)
      {
        ruleType: 'business_rule',
        area: 'HR',
        statement: 'New rule',
        operator: null,
        value: null,
        consequence: '',
        appliesTo: [],
      },
      // rule-omit is NOT in the submitted set → should be archived
    ])

    const updateCalls = hubStore.calls.filter(([op, table]) => op === 'update' && table === 'business_rules')
    const insertCalls = hubStore.calls.filter(([op, table]) => op === 'insert' && table === 'business_rules')

    // existing updated
    expect(updateCalls.some(([, , d]) => (d as any).id === 'rule-existing')).toBe(true)
    // new inserted
    expect(insertCalls).toHaveLength(1)
    // omitted archived
    const archiveCalls = updateCalls.filter(([, , d]) => (d as any).id === 'rule-omit' && (d as any).status === 'archived')
    expect(archiveCalls).toHaveLength(1)
  })
})

describe('OnboardingService optimistic concurrency', () => {
  it('throws StaleDraftError and performs no write when version mismatches', async () => {
    // Seed rule with version 2 but client submits version 1
    const existingRule = makeHubRow({ id: 'rule-stale', workspace_id: 'ws-1', version: 2 })
    const hubStore = makeFakeHubStore({ 'rule-stale': existingRule })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_rules') {
        hubStore.calls.push(['select', table, filters])
        return [existingRule]
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    const callsBefore = hubStore.calls.filter(([op]) => op === 'update').length

    await expect(
      svc.saveRules(ctx, [
        {
          id: 'rule-stale',
          version: 1, // stale — server has version 2
          ruleType: 'business_rule',
          area: 'Finance',
          statement: 'Some rule',
          operator: null,
          value: null,
          consequence: '',
          appliesTo: [],
        },
      ])
    ).rejects.toBeInstanceOf(StaleDraftError)

    const callsAfter = hubStore.calls.filter(([op]) => op === 'update').length
    expect(callsAfter).toBe(callsBefore) // no writes performed
  })
})

describe('OnboardingService.finish', () => {
  it('calls completionStore.complete before sendInvite', async () => {
    const callOrder: string[] = []

    const completionStore: CompletionStore = {
      async complete(_sessionId) {
        callOrder.push('complete')
        return {
          session_id: 'sess-1',
          workspace_id: 'ws-1',
          invite_ids: [{ id: 'inv-1', email: 'alice@example.com', token: 'tok-1' }],
          completed_at: '2024-01-02T00:00:00Z',
        }
      },
    }
    const sendInvite = vi.fn(async () => {
      callOrder.push('sendInvite')
    })

    const session = makeSession({ completed_steps: ['profile', 'rules', 'industry', 'people'] })
    const hubStore = makeFakeHubStore()
    const onboardingStore = makeFakeOnboardingStore(session)
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    const result = await svc.finish(ctx)

    expect(callOrder[0]).toBe('complete')
    expect(callOrder[1]).toBe('sendInvite')
    expect(result.invitesSent).toBe(1)
    expect(result.invitesFailed).toBe(0)
    expect(result.workspaceId).toBe('ws-1')
  })

  it('handles per-invite sendInvite failure: marks failed and still resolves', async () => {
    const markCalls: Array<[string, string]> = []

    const completionStore: CompletionStore = {
      async complete(_sessionId) {
        return {
          session_id: 'sess-1',
          workspace_id: 'ws-1',
          invite_ids: [
            { id: 'inv-ok', email: 'ok@example.com', token: 'tok-ok' },
            { id: 'inv-fail', email: 'fail@example.com', token: 'tok-fail' },
          ],
          completed_at: '2024-01-02T00:00:00Z',
        }
      },
    }
    const sendInvite = vi.fn(async ({ email }: { email: string; token: string; workspaceId: string }) => {
      if (email === 'fail@example.com') throw new Error('SMTP error')
    })

    const session = makeSession({ completed_steps: ['profile', 'rules', 'industry', 'people'] })
    const hubStore = makeFakeHubStore()

    const onboardingStore: OnboardingStore = {
      ...(makeFakeOnboardingStore(session) as any),
      async markInviteDelivery(id: string, status: 'sent' | 'failed') {
        markCalls.push([id, status])
      },
    }
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    const result = await svc.finish(ctx)

    expect(result.invitesSent).toBe(1)
    expect(result.invitesFailed).toBe(1)

    const failMark = markCalls.find(([id, s]) => id === 'inv-fail' && s === 'failed')
    expect(failMark).toBeDefined()
    const sentMark = markCalls.find(([id, s]) => id === 'inv-ok' && s === 'sent')
    expect(sentMark).toBeDefined()
  })
})

describe('OnboardingService.retryInvitation', () => {
  it('retries committed/failed drafts and marks sent', async () => {
    const markCalls: Array<[string, string]> = []
    const sendInvite = vi.fn()

    const inviteDraft = makeInviteDraft({ id: 'inv-retry', status: 'committed', invite_id: 'ws-invite-99' })

    const session = makeSession()
    const hubStore = makeFakeHubStore()
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })

    const onboardingStore: OnboardingStore = {
      ...(makeFakeOnboardingStore(session) as any),
      async listInviteDrafts(_sessionId: string) {
        return [inviteDraft]
      },
      async markInviteDelivery(id: string, status: 'sent' | 'failed') {
        markCalls.push([id, status])
      },
    }
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    await svc.retryInvitation(ctx, 'inv-retry')

    expect(sendInvite).toHaveBeenCalledWith({
      email: 'alice@example.com',
      token: 'tok-1',
      workspaceId: 'ws-1',
    })
    expect(markCalls).toContainEqual(['ws-invite-99', 'sent'])
  })

  it('throws if invite draft is not found or status is queued/sent', async () => {
    const session = makeSession()
    const hubStore = makeFakeHubStore()
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()

    const onboardingStore: OnboardingStore = {
      ...(makeFakeOnboardingStore(session) as any),
      async listInviteDrafts(_sessionId: string) {
        return [makeInviteDraft({ id: 'inv-sent', status: 'sent' })]
      },
    }
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    await expect(svc.retryInvitation(ctx, 'inv-sent')).rejects.toThrow()
    await expect(svc.retryInvitation(ctx, 'inv-not-found')).rejects.toThrow()
  })

  it('throws if invite draft status is queued', async () => {
    const session = makeSession()
    const hubStore = makeFakeHubStore()
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()

    const onboardingStore: OnboardingStore = {
      ...(makeFakeOnboardingStore(session) as any),
      async listInviteDrafts(_sessionId: string) {
        return [makeInviteDraft({ id: 'inv-queued', status: 'queued' })]
      },
    }
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    await expect(svc.retryInvitation(ctx, 'inv-queued')).rejects.toThrow()
    expect(sendInvite).not.toHaveBeenCalled()
  })
})

describe('OnboardingService optimistic concurrency — StaleDraftError fields', () => {
  it('StaleDraftError has correct entity and id fields', async () => {
    const existingRule = makeHubRow({ id: 'rule-stale2', workspace_id: 'ws-1', version: 3 })
    const hubStore = makeFakeHubStore({ 'rule-stale2': existingRule })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_rules') {
        hubStore.calls.push(['select', table, filters])
        return [existingRule]
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    let caughtError: unknown
    try {
      await svc.saveRules(ctx, [
        {
          id: 'rule-stale2',
          version: 1, // stale — server has version 3
          ruleType: 'business_rule',
          area: 'Finance',
          statement: 'Some rule',
          operator: null,
          value: null,
          consequence: '',
          appliesTo: [],
        },
      ])
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(StaleDraftError)
    const err = caughtError as StaleDraftError
    expect(err.entity).toBe('business_rules')
    expect(err.id).toBe('rule-stale2')
  })
})

describe('OnboardingService.savePeople', () => {
  it('writes no workspace_members or workspace_invites rows', async () => {
    const session = makeSession({ completed_steps: ['profile', 'rules', 'industry'] })
    const hubStore = makeFakeHubStore()
    const reconcileCalls: unknown[] = []

    const onboardingStore: OnboardingStore & { progressCalls: Array<[string, string, string[]]> } = {
      ...(makeFakeOnboardingStore(session) as any),
      async reconcileInviteDrafts(sessionId: string, workspaceId: string, rows: unknown[]) {
        reconcileCalls.push({ sessionId, workspaceId, rows })
        return []
      },
    }
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    await svc.savePeople(ctx, [
      {
        personName: 'Alice',
        title: 'Manager',
        email: 'alice@example.com',
        responsibilities: [],
        role: 'manager',
        accessScope: {},
        invite: true,
      },
    ])

    // No writes to workspace_members or workspace_invites
    const forbiddenWrites = hubStore.calls.filter(
      ([, table]) => table === 'workspace_members' || table === 'workspace_invites'
    )
    expect(forbiddenWrites).toHaveLength(0)

    // Invite intent went through reconcileInviteDrafts
    expect(reconcileCalls).toHaveLength(1)
  })
})

describe('OnboardingService security — cross-tenant IDOR guard', () => {
  it('saveIndustry: rejects obligation whose workspace_id belongs to a different workspace and performs no write', async () => {
    // Attacker is in ws-1 (ctx.workspaceId) but submits obl-ws2 which belongs to ws-2
    const foreignObligation = makeHubRow({ id: 'obl-ws2', workspace_id: 'ws-2', version: 1, status: 'draft' } as any)
    const profileRow = makeHubRow({ id: 'profile-1', workspace_id: 'ws-1' })

    const hubStore = makeFakeHubStore({ 'obl-ws2': foreignObligation, 'profile-1': profileRow })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_profile') {
        hubStore.calls.push(['select', table, filters])
        return [profileRow]
      }
      if (table === 'compliance_obligations') {
        hubStore.calls.push(['select', table, filters])
        return [] // workspace ws-1 has no obligations of its own
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile', 'rules'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    const writesCountBefore = hubStore.calls.filter(([op]) => op === 'update' || op === 'insert').length

    await expect(
      svc.saveIndustry(ctx, {
        anzsicCode: '7000',
        obligations: [{ id: 'obl-ws2', version: 1, name: 'Hijack Obligation', description: 'evil' }],
      })
    ).rejects.toThrow('Obligation obl-ws2 not found')

    const writesCountAfter = hubStore.calls.filter(([op]) => op === 'update' || op === 'insert').length
    expect(writesCountAfter).toBe(writesCountBefore) // no writes performed — row must not be hijacked
  })

  it('saveRules: rejects rule whose workspace_id belongs to a different workspace and performs no write', async () => {
    // Attacker in ws-1 submits rule-ws2 which belongs to ws-2
    const foreignRule = makeHubRow({ id: 'rule-ws2', workspace_id: 'ws-2', version: 1 })

    const hubStore = makeFakeHubStore({ 'rule-ws2': foreignRule })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_rules') {
        hubStore.calls.push(['select', table, filters])
        return [] // ws-1 has no rules of its own
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    const writesCountBefore = hubStore.calls.filter(([op]) => op === 'update' || op === 'insert').length

    await expect(
      svc.saveRules(ctx, [
        {
          id: 'rule-ws2',
          version: 1,
          ruleType: 'business_rule',
          area: 'Finance',
          statement: 'Hijack rule',
          operator: null,
          value: null,
          consequence: '',
          appliesTo: [],
        },
      ])
    ).rejects.toThrow('Rule rule-ws2 not found')

    const writesCountAfter = hubStore.calls.filter(([op]) => op === 'update' || op === 'insert').length
    expect(writesCountAfter).toBe(writesCountBefore) // no writes performed
  })

  it('savePeople: rejects person whose workspace_id belongs to a different workspace and performs no write', async () => {
    // Attacker is in ws-1 (ctx.workspaceId) but submits person-ws2 which belongs to ws-2
    const foreignPerson = makeHubRow({ id: 'person-ws2', workspace_id: 'ws-2', version: 1 })

    const hubStore = makeFakeHubStore({ 'person-ws2': foreignPerson })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'org_people') {
        hubStore.calls.push(['select', table, filters])
        return [] // ws-1 has no people of its own
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile', 'rules', 'industry'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    const writesCountBefore = hubStore.calls.filter(([op]) => op === 'update' || op === 'insert').length

    await expect(
      svc.savePeople(ctx, [
        {
          id: 'person-ws2',
          version: 1,
          personName: 'Hijack Person',
          title: 'Attacker',
          email: 'evil@example.com',
          responsibilities: [],
          role: 'staff',
          accessScope: {},
          invite: false,
        },
      ])
    ).rejects.toThrow('Person person-ws2 not found')

    const writesCountAfter = hubStore.calls.filter(([op]) => op === 'update' || op === 'insert').length
    expect(writesCountAfter).toBe(writesCountBefore) // no writes performed — row must not be hijacked
  })
})

describe('OnboardingService.saveIndustry', () => {
  it('updates profile anzsic_code and advances step to people', async () => {
    const profileRow = makeHubRow({ id: 'profile-1', workspace_id: 'ws-1' })
    const hubStore = makeFakeHubStore({ 'profile-1': profileRow })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_profile') {
        hubStore.calls.push(['select', table, filters])
        return [profileRow]
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile', 'rules'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    await svc.saveIndustry(ctx, { anzsicCode: '7000', obligations: [] })

    const profileUpdate = hubStore.calls.find(
      ([op, table, d]) => op === 'update' && table === 'business_profile' && (d as any).anzsic_code === '7000'
    )
    expect(profileUpdate).toBeDefined()

    const [sid, step, completed] = onboardingStore.progressCalls[0]
    expect(sid).toBe('sess-1')
    expect(step).toBe('people')
    expect(completed).toContain('industry')
  })

  it('inserts new obligation as draft with source:custom and archives omitted session drafts', async () => {
    const profileRow = makeHubRow({ id: 'profile-1', workspace_id: 'ws-1' })
    const omittedObligation = makeHubRow({ id: 'obl-omit', workspace_id: 'ws-1', version: 1, status: 'draft' } as any)

    const hubStore = makeFakeHubStore({ 'profile-1': profileRow, 'obl-omit': omittedObligation })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_profile') {
        hubStore.calls.push(['select', table, filters])
        return [profileRow]
      }
      if (table === 'compliance_obligations') {
        hubStore.calls.push(['select', table, filters])
        return [omittedObligation]
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile', 'rules'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    await svc.saveIndustry(ctx, {
      anzsicCode: '7000',
      obligations: [
        { name: 'New Obligation', description: 'Must comply' }, // no id = new
        // obl-omit NOT in submitted set → should be archived
      ],
    })

    // New obligation inserted with correct fields
    const insertObl = hubStore.calls.find(
      ([op, table, d]) =>
        op === 'insert' &&
        table === 'compliance_obligations' &&
        (d as any).name === 'New Obligation' &&
        (d as any).source === 'custom' &&
        (d as any).subscribe_updates === false &&
        (d as any).status === 'draft'
    )
    expect(insertObl).toBeDefined()

    // Omitted draft obligation archived
    const archiveObl = hubStore.calls.find(
      ([op, table, d]) =>
        op === 'update' &&
        table === 'compliance_obligations' &&
        (d as any).id === 'obl-omit' &&
        (d as any).status === 'archived'
    )
    expect(archiveObl).toBeDefined()
  })

  it('throws StaleDraftError for obligation with stale version', async () => {
    const profileRow = makeHubRow({ id: 'profile-1', workspace_id: 'ws-1' })
    const staleObl = makeHubRow({ id: 'obl-stale', workspace_id: 'ws-1', version: 5, status: 'draft' } as any)

    const hubStore = makeFakeHubStore({ 'profile-1': profileRow, 'obl-stale': staleObl })

    const origSelect = hubStore.select.bind(hubStore)
    ;(hubStore as any).select = async (table: string, filters: Record<string, unknown>) => {
      if (table === 'business_profile') {
        hubStore.calls.push(['select', table, filters])
        return [profileRow]
      }
      if (table === 'compliance_obligations') {
        hubStore.calls.push(['select', table, filters])
        return [staleObl]
      }
      return origSelect(table, filters)
    }

    const session = makeSession({ completed_steps: ['profile', 'rules'] })
    const onboardingStore = makeFakeOnboardingStore(session)
    const completionStore = makeFakeCompletionStore({ session_id: 'sess-1', workspace_id: 'ws-1', invite_ids: [], completed_at: '' })
    const sendInvite = vi.fn()
    const hub = makeFakeHub(hubStore)

    const svc = createOnboardingService({ hub: hub as any, hubStore, onboardingStore, completionStore, sendInvite })

    let caughtError: unknown
    try {
      await svc.saveIndustry(ctx, {
        anzsicCode: '7000',
        obligations: [
          { id: 'obl-stale', version: 1, name: 'Old', description: 'stale' }, // server has version 5
        ],
      })
    } catch (e) {
      caughtError = e
    }

    expect(caughtError).toBeInstanceOf(StaleDraftError)
    const err = caughtError as StaleDraftError
    expect(err.entity).toBe('compliance_obligations')
    expect(err.id).toBe('obl-stale')
  })
})
