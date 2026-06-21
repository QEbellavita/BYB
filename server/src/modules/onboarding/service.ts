import type { ContextHub } from '../../context/index.js'
import type { HubStore } from '../../context/types.js'
import type { CompletionStore } from '../../context/onboarding.js'
import {
  validateProfile,
  validateRules,
  validateIndustry,
  validatePeople,
} from './validation.js'
import type {
  OnboardingContext,
  OnboardingSnapshot,
  OnboardingStore,
  OnboardingService,
  FinishResult,
  ProfileInput,
  RuleInput,
  PersonInput,
  ObligationInput,
} from './types.js'

// ---------------------------------------------------------------------------
// StaleDraftError
// ---------------------------------------------------------------------------

export class StaleDraftError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string
  ) {
    super(`Stale draft: ${entity} id=${id} — another version was saved since you loaded`)
    this.name = 'StaleDraftError'
  }
}

// ---------------------------------------------------------------------------
// Deps type (mirrors ContextHub shape used by service)
// ---------------------------------------------------------------------------

type HubLike = {
  profile: Pick<typeof ContextHub.profile, 'list' | 'get' | 'upsert' | 'approve' | 'deprecate'>
  rules: Pick<typeof ContextHub.rules, 'list' | 'get' | 'upsert' | 'approve' | 'deprecate'>
  obligations: Pick<typeof ContextHub.obligations, 'list' | 'get' | 'upsert' | 'approve' | 'deprecate'>
  people: Pick<typeof ContextHub.people, 'list' | 'get' | 'upsert' | 'approve' | 'deprecate'>
}

interface ServiceDeps {
  hub: HubLike
  hubStore: HubStore
  onboardingStore: OnboardingStore
  completionStore: CompletionStore
  sendInvite: (invite: { email: string; token: string; workspaceId: string }) => Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createOnboardingService(deps: ServiceDeps): OnboardingService {
  const { hub, hubStore, onboardingStore, completionStore, sendInvite } = deps

  async function load(ctx: OnboardingContext): Promise<OnboardingSnapshot> {
    const session = await onboardingStore.getSession(ctx.workspaceId)
    if (!session) throw new Error(`No onboarding session for workspace ${ctx.workspaceId}`)

    const [profileRows, rules, obligations, people, inviteDrafts] = await Promise.all([
      hub.profile.list(hubStore, ctx.workspaceId),
      hub.rules.list(hubStore, ctx.workspaceId),
      hub.obligations.list(hubStore, ctx.workspaceId),
      hub.people.list(hubStore, ctx.workspaceId),
      onboardingStore.listInviteDrafts(ctx.sessionId),
    ])

    const profile = profileRows.length > 0 ? (profileRows[0] as Record<string, unknown>) : null

    return {
      session,
      profile,
      rules: rules as Record<string, unknown>[],
      obligations: obligations as Record<string, unknown>[],
      people: people as Record<string, unknown>[],
      inviteDrafts,
    }
  }

  async function saveProfile(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot> {
    const validation = validateProfile(input as ProfileInput)
    if (!validation.ok) {
      const err = Object.assign(new Error('Validation failed'), { errors: validation.errors })
      throw err
    }
    const { name, jurisdiction, size, description } = validation.value

    // Upsert — check if profile already exists to do an update
    const existing = await hub.profile.list(hubStore, ctx.workspaceId)
    if (existing.length > 0) {
      await hub.profile.upsert(hubStore, {
        id: existing[0].id,
        workspace_id: ctx.workspaceId,
        status: 'draft',
        name,
        jurisdiction,
        size,
        description,
      })
    } else {
      await hub.profile.upsert(hubStore, {
        workspace_id: ctx.workspaceId,
        status: 'draft',
        name,
        jurisdiction,
        size,
        description,
      })
    }

    const session = await onboardingStore.getSession(ctx.workspaceId)
    const completedSteps = session?.completed_steps ?? []
    const next = completedSteps.includes('profile') ? completedSteps : [...completedSteps, 'profile' as const]
    await onboardingStore.updateProgress(ctx.sessionId, 'rules', next)

    return load(ctx)
  }

  async function saveRules(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot> {
    const validation = validateRules(input as RuleInput[])
    if (!validation.ok) {
      const err = Object.assign(new Error('Validation failed'), { errors: validation.errors })
      throw err
    }
    const rules = validation.value

    // Load all current rules for this workspace so we can archive omitted ones
    const existingRules = await hub.rules.list(hubStore, ctx.workspaceId)
    const submittedIds = new Set(rules.filter(r => r.id).map(r => r.id as string))

    for (const rule of rules) {
      if (rule.id) {
        // Optimistic concurrency check
        const current = await hubStore.getById('business_rules', rule.id)
        if (!current) throw new Error(`Rule ${rule.id} not found`)
        if (current.workspace_id !== ctx.workspaceId) throw new Error(`Rule ${rule.id} not found`)
        if (current.version !== rule.version) {
          throw new StaleDraftError('business_rules', rule.id)
        }
        const { id, version: _v, ...fields } = rule
        await hub.rules.upsert(hubStore, {
          id,
          workspace_id: ctx.workspaceId,
          status: 'draft',
          rule_type: fields.ruleType,
          area: fields.area,
          statement: fields.statement,
          operator: fields.operator,
          value: fields.value,
          consequence: fields.consequence,
          applies_to: fields.appliesTo,
        })
      } else {
        const { version: _v, id: _id, ...fields } = rule
        await hub.rules.upsert(hubStore, {
          workspace_id: ctx.workspaceId,
          status: 'draft',
          rule_type: fields.ruleType,
          area: fields.area,
          statement: fields.statement,
          operator: fields.operator,
          value: fields.value,
          consequence: fields.consequence,
          applies_to: fields.appliesTo,
        })
      }
    }

    // Archive session-draft rules that were in the workspace but not in the submitted set
    for (const existing of existingRules) {
      if (!submittedIds.has(existing.id) && existing.status === 'draft') {
        await hub.rules.deprecate(hubStore, existing.id)
      }
    }

    const session = await onboardingStore.getSession(ctx.workspaceId)
    const completedSteps = session?.completed_steps ?? []
    const next = completedSteps.includes('rules') ? completedSteps : [...completedSteps, 'rules' as const]
    await onboardingStore.updateProgress(ctx.sessionId, 'industry', next)

    return load(ctx)
  }

  async function saveIndustry(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot> {
    const validation = validateIndustry(input as { anzsicCode: string })
    if (!validation.ok) {
      const err = Object.assign(new Error('Validation failed'), { errors: validation.errors })
      throw err
    }
    const { anzsicCode } = validation.value

    // Read obligations separately (not through validateIndustry)
    const obligations: ObligationInput[] = (input as { obligations?: ObligationInput[] }).obligations ?? []

    // Validate obligations: trim and check non-empty name
    for (const o of obligations) {
      if (!o.name.trim()) {
        throw Object.assign(new Error('Validation failed'), { errors: { obligations: 'obligation name must not be empty' } })
      }
    }

    // Reconcile obligations (mirror the saveRules pattern)
    const existingObligations = await hub.obligations.list(hubStore, ctx.workspaceId)
    const submittedIds = new Set(obligations.filter(o => o.id).map(o => o.id as string))

    for (const o of obligations) {
      if (o.id) {
        // Optimistic concurrency check
        const current = await hubStore.getById('compliance_obligations', o.id)
        if (!current) throw new Error(`Obligation ${o.id} not found`)
        if (current.workspace_id !== ctx.workspaceId) throw new Error(`Obligation ${o.id} not found`)
        if (current.version !== o.version) {
          throw new StaleDraftError('compliance_obligations', o.id)
        }
        await hub.obligations.upsert(hubStore, {
          id: o.id,
          workspace_id: ctx.workspaceId,
          status: 'draft',
          name: o.name.trim(),
          description: o.description.trim(),
        })
      } else {
        await hub.obligations.upsert(hubStore, {
          workspace_id: ctx.workspaceId,
          status: 'draft',
          name: o.name.trim(),
          description: o.description.trim(),
          source: 'custom',
          subscribe_updates: false,
          anzsic_code: anzsicCode,
        })
      }
    }

    // Archive omitted session-draft obligations
    for (const existing of existingObligations) {
      if (!submittedIds.has(existing.id) && existing.status === 'draft') {
        await hub.obligations.deprecate(hubStore, existing.id)
      }
    }

    // Update profile with anzsic_code
    const existingProfiles = await hub.profile.list(hubStore, ctx.workspaceId)
    if (existingProfiles.length > 0) {
      await hub.profile.upsert(hubStore, {
        id: existingProfiles[0].id,
        anzsic_code: anzsicCode,
      })
    }

    const session = await onboardingStore.getSession(ctx.workspaceId)
    const completedSteps = session?.completed_steps ?? []
    const next = completedSteps.includes('industry') ? completedSteps : [...completedSteps, 'industry' as const]
    await onboardingStore.updateProgress(ctx.sessionId, 'people', next)

    return load(ctx)
  }

  async function savePeople(ctx: OnboardingContext, input: unknown): Promise<OnboardingSnapshot> {
    const validation = validatePeople(input as PersonInput[])
    if (!validation.ok) {
      const err = Object.assign(new Error('Validation failed'), { errors: validation.errors })
      throw err
    }
    const people = validation.value

    // Track upserted org_people rows so we can use their ids for invite drafts
    const upsertedPeople: Array<{ person: typeof people[0]; rowId: string }> = []

    for (const person of people) {
      let upsertedRow: { id: string }
      if (person.id) {
        // Optimistic concurrency check
        const current = await hubStore.getById('org_people', person.id)
        if (!current) throw new Error(`Person ${person.id} not found`)
        if (current.workspace_id !== ctx.workspaceId) throw new Error(`Person ${person.id} not found`)
        if (current.version !== person.version) {
          throw new StaleDraftError('org_people', person.id)
        }
        const { id, version: _v, invite: _inv, ...fields } = person
        upsertedRow = await hub.people.upsert(hubStore, {
          id,
          workspace_id: ctx.workspaceId,
          status: 'draft',
          person_name: fields.personName,
          title: fields.title,
          email: fields.email,
          responsibilities: fields.responsibilities,
          access_scope: fields.accessScope,
        })
      } else {
        const { version: _v, id: _id, invite: _inv, ...fields } = person
        upsertedRow = await hub.people.upsert(hubStore, {
          workspace_id: ctx.workspaceId,
          status: 'draft',
          person_name: fields.personName,
          title: fields.title,
          email: fields.email,
          responsibilities: fields.responsibilities,
          access_scope: fields.accessScope,
        })
      }
      upsertedPeople.push({ person, rowId: upsertedRow.id })
    }

    // Reconcile invite drafts for people with invite:true
    const invitePeople = upsertedPeople.filter(({ person }) => person.invite)
    if (invitePeople.length > 0) {
      await onboardingStore.reconcileInviteDrafts(
        ctx.sessionId,
        ctx.workspaceId,
        invitePeople.map(({ person, rowId }) => ({
          org_person_id: rowId,
          email: person.email,
          role: person.role,
          access_scope: person.accessScope,
        }))
      )
    }

    const session = await onboardingStore.getSession(ctx.workspaceId)
    const completedSteps = session?.completed_steps ?? []
    const next = completedSteps.includes('people') ? completedSteps : [...completedSteps, 'people' as const]
    await onboardingStore.updateProgress(ctx.sessionId, 'review', next)

    return load(ctx)
  }

  async function finish(ctx: OnboardingContext): Promise<FinishResult> {
    // Call completion store first — this commits the session
    const result = await completionStore.complete(ctx.sessionId)

    let invitesSent = 0
    let invitesFailed = 0

    // Send invites, catching per-invite failures
    for (const invite of result.invite_ids) {
      try {
        await sendInvite({ email: invite.email, token: invite.token, workspaceId: result.workspace_id })
        await onboardingStore.markInviteDelivery(invite.id, 'sent')
        invitesSent++
      } catch {
        await onboardingStore.markInviteDelivery(invite.id, 'failed')
        invitesFailed++
      }
    }

    return {
      workspaceId: result.workspace_id,
      completedAt: result.completed_at,
      invitesSent,
      invitesFailed,
    }
  }

  async function retryInvitation(ctx: OnboardingContext, inviteDraftId: string): Promise<void> {
    const drafts = await onboardingStore.listInviteDrafts(ctx.sessionId)
    const draft = drafts.find(d => d.id === inviteDraftId)

    if (!draft) {
      throw new Error(`Invite draft ${inviteDraftId} not found`)
    }

    if (draft.status !== 'committed' && draft.status !== 'failed') {
      throw new Error(`Invite draft ${inviteDraftId} has status '${draft.status}' — only committed or failed drafts can be retried`)
    }

    await sendInvite({ email: draft.email, token: draft.token ?? '', workspaceId: draft.workspace_id })
    if (draft.invite_id) await onboardingStore.markInviteDelivery(draft.invite_id, 'sent')
  }

  return { load, saveProfile, saveRules, saveIndustry, savePeople, finish, retryInvitation }
}
