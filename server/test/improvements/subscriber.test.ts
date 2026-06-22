import { describe, it, expect, vi } from 'vitest'
import { createRegistry } from '../../src/context/events.js'
import type { ContextEvent } from '../../src/context/events.js'
import {
  registerImprovementSubscriber,
  HIGH_SEVERITY_MIN,
  RECURRING_COMPLAINTS_THRESHOLD,
  RECURRING_WINDOW_DAYS,
} from '../../src/modules/improvements/subscriber.js'
import type { AutoSuggestionRow } from '../../src/modules/improvements/types.js'
import type { RiskRow } from '../../src/modules/risk/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2025-06-15T00:00:00.000Z')
const fixedNow = () => FIXED_NOW

function makeRiskRow(overrides: Partial<RiskRow> = {}): RiskRow {
  return {
    id: 'risk-1',
    workspace_id: 'ws-1',
    version: 1,
    title: 'Fire Risk',
    description: null,
    category: null,
    likelihood: 4,
    impact: 3,
    severity: 'high',
    owner_person_id: null,
    treatment: null,
    status: 'open',
    review_date: null,
    framework_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeRiskEvent(risk: RiskRow, type = 'risk.updated'): ContextEvent {
  return {
    id: 'evt-1',
    workspace_id: risk.workspace_id,
    type,
    entity_type: 'risk_entry',
    entity_id: risk.id,
    before: null,
    after: risk,
    actor: 'user-1',
    created_at: '2025-06-15T00:00:00Z',
  }
}

function makeComplaintEvent(complaint: {
  id: string
  workspace_id: string
  category?: string | null
  status?: string
}, type = 'complaint.created'): ContextEvent {
  return {
    id: 'evt-2',
    workspace_id: complaint.workspace_id,
    type,
    entity_type: 'complaint',
    entity_id: complaint.id,
    before: null,
    after: complaint,
    actor: 'user-1',
    created_at: '2025-06-15T00:00:00Z',
  }
}

function makeFakeDeps() {
  const upsertCalls: AutoSuggestionRow[] = []
  const clearCalls: { workspaceId: string; dedupKey: string }[] = []

  return {
    riskStore: {
      getById: vi.fn().mockResolvedValue(null),
    },
    complaintStore: {
      getById: vi.fn().mockResolvedValue(null),
      countByCategorySince: vi.fn().mockResolvedValue(0),
    },
    improvementStore: {
      upsertAuto: vi.fn(async (row: AutoSuggestionRow) => { upsertCalls.push(row) }),
      clearAuto: vi.fn(async (workspaceId: string, dedupKey: string) => { clearCalls.push({ workspaceId, dedupKey }) }),
    },
    _upsertCalls: upsertCalls,
    _clearCalls: clearCalls,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerImprovementSubscriber', () => {
  describe('untreated_high_risk rule', () => {
    it('fires upsertAuto for high-severity open untreated risk', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      // likelihood 4 * impact 3 = 12 = HIGH_SEVERITY_MIN
      const risk = makeRiskRow({ likelihood: 4, impact: 3, status: 'open', treatment: null })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      expect(deps._upsertCalls).toHaveLength(1)
      expect(deps._upsertCalls[0]).toMatchObject({
        workspace_id: 'ws-1',
        source: 'auto',
        trigger_kind: 'untreated_high_risk',
        dedup_key: `untreated_high_risk:risk-1`,
        source_ref: { risk_id: 'risk-1' },
      })
    })

    it('fires for risk with severity ABOVE threshold', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      // likelihood 5 * impact 5 = 25 > 12
      const risk = makeRiskRow({ likelihood: 5, impact: 5, status: 'open', treatment: null })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      expect(deps._upsertCalls).toHaveLength(1)
      expect(deps._upsertCalls[0].trigger_kind).toBe('untreated_high_risk')
    })

    it('does NOT fire when likelihood*impact < HIGH_SEVERITY_MIN', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      // 3 * 3 = 9 < 12
      const risk = makeRiskRow({ likelihood: 3, impact: 3, status: 'open', treatment: null })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      const untreated = deps._upsertCalls.filter(c => c.trigger_kind === 'untreated_high_risk')
      expect(untreated).toHaveLength(0)
    })

    it('calls clearAuto when treatment is added to a high-severity risk', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const risk = makeRiskRow({
        likelihood: 4,
        impact: 3,
        status: 'open',
        treatment: 'Buy insurance policy', // non-empty
      })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      expect(deps._clearCalls).toHaveLength(1)
      expect(deps._clearCalls[0]).toEqual({
        workspaceId: 'ws-1',
        dedupKey: 'untreated_high_risk:risk-1',
      })
      // Should NOT upsert
      const untreated = deps._upsertCalls.filter(c => c.trigger_kind === 'untreated_high_risk')
      expect(untreated).toHaveLength(0)
    })

    it('calls clearAuto when risk is closed (even with empty treatment)', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const risk = makeRiskRow({
        likelihood: 4,
        impact: 3,
        status: 'closed',
        treatment: null,
      })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      const clearForRisk = deps._clearCalls.filter(c => c.dedupKey === 'untreated_high_risk:risk-1')
      expect(clearForRisk).toHaveLength(1)
    })

    it('dedup: second identical event does not create a second suggestion (upsertAuto called twice but idempotent on open)', async () => {
      // The store's upsertAuto is idempotent by contract; we verify the subscriber
      // calls upsertAuto (not the idempotency guard in the store) — so it IS called twice,
      // but the store skips the insert. We just verify the dedup_key is stable.
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const risk = makeRiskRow({ likelihood: 4, impact: 3, status: 'open', treatment: null })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))
      await handler(makeRiskEvent(risk)) // second identical event

      // Both calls use same dedup_key — the store itself handles idempotency
      expect(deps._upsertCalls.every(c => c.dedup_key === 'untreated_high_risk:risk-1')).toBe(true)
      // The dedup_key is stable across repeated calls
      expect(deps._upsertCalls[0].dedup_key).toBe(deps._upsertCalls[1].dedup_key)
    })
  })

  describe('overdue_risk_review rule', () => {
    it('fires upsertAuto when review_date < today and status is not closed', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      // FIXED_NOW = 2025-06-15; review_date in the past
      const risk = makeRiskRow({
        id: 'risk-2',
        status: 'open',
        review_date: '2025-06-01',
      })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      const overdue = deps._upsertCalls.filter(c => c.trigger_kind === 'overdue_risk_review')
      expect(overdue).toHaveLength(1)
      expect(overdue[0]).toMatchObject({
        workspace_id: 'ws-1',
        trigger_kind: 'overdue_risk_review',
        dedup_key: 'overdue_risk_review:risk-2',
        source_ref: { risk_id: 'risk-2' },
      })
    })

    it('does NOT fire when review_date is today or in the future', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const risk = makeRiskRow({
        status: 'open',
        review_date: '2025-06-15', // same as FIXED_NOW date — NOT past
      })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      const overdue = deps._upsertCalls.filter(c => c.trigger_kind === 'overdue_risk_review')
      expect(overdue).toHaveLength(0)
    })

    it('does NOT fire when review_date is past but risk is closed', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const risk = makeRiskRow({
        status: 'closed',
        review_date: '2025-01-01',
      })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      const overdue = deps._upsertCalls.filter(c => c.trigger_kind === 'overdue_risk_review')
      expect(overdue).toHaveLength(0)
    })

    it('does NOT fire when review_date is absent', async () => {
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const risk = makeRiskRow({ status: 'open', review_date: null })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      const overdue = deps._upsertCalls.filter(c => c.trigger_kind === 'overdue_risk_review')
      expect(overdue).toHaveLength(0)
    })

    it('uses injected now() — does NOT call Date.now() internally', async () => {
      // Verify determinism: both past and future behaviours controlled by injected now
      const pastNow = () => new Date('2025-01-01T00:00:00.000Z')
      const deps = makeFakeDeps()
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, pastNow)

      // review_date 2025-06-01 is FUTURE relative to 2025-01-01
      const risk = makeRiskRow({ status: 'open', review_date: '2025-06-01' })
      const [handler] = registry.handlersFor('risk.updated')
      await handler(makeRiskEvent(risk))

      const overdue = deps._upsertCalls.filter(c => c.trigger_kind === 'overdue_risk_review')
      // Should NOT fire because review_date > injected now
      expect(overdue).toHaveLength(0)
    })
  })

  describe('recurring_complaints rule', () => {
    it('fires upsertAuto when countByCategorySince returns >= THRESHOLD', async () => {
      const deps = makeFakeDeps()
      deps.complaintStore.countByCategorySince.mockResolvedValue(RECURRING_COMPLAINTS_THRESHOLD)
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const complaint = { id: 'c-1', workspace_id: 'ws-1', category: 'billing', status: 'new' }
      const [handler] = registry.handlersFor('complaint.created')
      await handler(makeComplaintEvent(complaint))

      const recurring = deps._upsertCalls.filter(c => c.trigger_kind === 'recurring_complaints')
      expect(recurring).toHaveLength(1)
      expect(recurring[0]).toMatchObject({
        workspace_id: 'ws-1',
        trigger_kind: 'recurring_complaints',
        dedup_key: 'recurring_complaints:billing',
        source_ref: { category: 'billing' },
      })
    })

    it('does NOT fire when count < RECURRING_COMPLAINTS_THRESHOLD', async () => {
      const deps = makeFakeDeps()
      deps.complaintStore.countByCategorySince.mockResolvedValue(RECURRING_COMPLAINTS_THRESHOLD - 1)
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const complaint = { id: 'c-1', workspace_id: 'ws-1', category: 'billing', status: 'new' }
      const [handler] = registry.handlersFor('complaint.created')
      await handler(makeComplaintEvent(complaint))

      const recurring = deps._upsertCalls.filter(c => c.trigger_kind === 'recurring_complaints')
      expect(recurring).toHaveLength(0)
    })

    it('skips entirely when complaint has no category', async () => {
      const deps = makeFakeDeps()
      deps.complaintStore.countByCategorySince.mockResolvedValue(5)
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const complaint = { id: 'c-1', workspace_id: 'ws-1', category: null, status: 'new' }
      const [handler] = registry.handlersFor('complaint.created')
      await handler(makeComplaintEvent(complaint))

      expect(deps.complaintStore.countByCategorySince).not.toHaveBeenCalled()
      const recurring = deps._upsertCalls.filter(c => c.trigger_kind === 'recurring_complaints')
      expect(recurring).toHaveLength(0)
    })

    it('passes correct sinceIso computed from injected now', async () => {
      const deps = makeFakeDeps()
      deps.complaintStore.countByCategorySince.mockResolvedValue(3)
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const complaint = { id: 'c-1', workspace_id: 'ws-1', category: 'fraud', status: 'new' }
      const [handler] = registry.handlersFor('complaint.created')
      await handler(makeComplaintEvent(complaint))

      // Expected sinceIso = FIXED_NOW - 90 days
      const expectedSince = new Date(FIXED_NOW.getTime() - RECURRING_WINDOW_DAYS * 864e5).toISOString()
      expect(deps.complaintStore.countByCategorySince).toHaveBeenCalledWith('ws-1', 'fraud', expectedSince)
    })

    it('dedup_key uses category — same category on second event produces same key', async () => {
      const deps = makeFakeDeps()
      deps.complaintStore.countByCategorySince.mockResolvedValue(3)
      const registry = createRegistry()
      registerImprovementSubscriber(registry, deps, fixedNow)

      const complaint = { id: 'c-1', workspace_id: 'ws-1', category: 'fraud', status: 'new' }
      const [handler] = registry.handlersFor('complaint.created')
      await handler(makeComplaintEvent(complaint))
      await handler(makeComplaintEvent({ ...complaint, id: 'c-2' }))

      const recurring = deps._upsertCalls.filter(c => c.trigger_kind === 'recurring_complaints')
      expect(recurring).toHaveLength(2)
      // Both events produce same dedup_key — store's upsertAuto handles idempotency
      expect(recurring[0].dedup_key).toBe('recurring_complaints:fraud')
      expect(recurring[1].dedup_key).toBe('recurring_complaints:fraud')
    })
  })

  describe('constants', () => {
    it('exports correct named constants', () => {
      expect(RECURRING_COMPLAINTS_THRESHOLD).toBe(3)
      expect(RECURRING_WINDOW_DAYS).toBe(90)
      expect(HIGH_SEVERITY_MIN).toBe(12)
    })
  })
})
