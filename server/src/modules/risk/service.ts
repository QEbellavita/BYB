import { StaleDraftError } from '../../errors.js'
import { severityBucket } from './severity.js'
import { validateRisk } from './validation.js'
import type { RiskRow, RiskStore, RiskService, RiskServiceContext } from './types.js'
import type { Publish } from '../../events/publish.js'
import type { LinkStore } from '../../context/links.js'
import { links as linksUtils } from '../../context/links.js'

interface ServiceDeps {
  store: RiskStore
  publish: Publish
  links: typeof linksUtils
  linkStore: LinkStore
}

export function createRiskService(deps: ServiceDeps): RiskService {
  const { store, publish, links, linkStore } = deps

  async function list(ctx: RiskServiceContext): Promise<RiskRow[]> {
    return store.list(ctx.workspaceId)
  }

  async function create(ctx: RiskServiceContext, input: unknown): Promise<RiskRow> {
    const validation = validateRisk(input)
    if (!validation.ok) {
      throw Object.assign(new Error('Validation failed'), { errors: validation.errors })
    }
    const { title, description, category, likelihood, impact, ownerPersonId, treatment, reviewDate, frameworkId } = validation.value
    const severity = severityBucket(likelihood, impact)

    const row = await store.create({
      workspace_id: ctx.workspaceId,
      title,
      description: description ?? null,
      category: category ?? null,
      likelihood,
      impact,
      severity,
      owner_person_id: ownerPersonId ?? null,
      treatment: treatment ?? null,
      status: 'open',
      review_date: reviewDate ?? null,
      framework_id: frameworkId ?? null,
    })

    await publish({
      workspace_id: ctx.workspaceId,
      type: 'risk.created',
      entity_type: 'risk_entry',
      entity_id: row.id,
      after: row,
      actor: ctx.userId,
    })

    return row
  }

  async function update(ctx: RiskServiceContext, id: string, input: unknown): Promise<RiskRow> {
    const raw = input as Record<string, unknown>
    const submittedVersion = raw['version'] as number | undefined

    // Optimistic concurrency check — version is required for all updates
    if (submittedVersion === undefined) {
      throw Object.assign(new Error('Validation failed'), { errors: { version: 'Required for update' } })
    }
    const current = await store.getById(id)
    if (!current) throw new Error(`Risk ${id} not found`)
    if (current.workspace_id !== ctx.workspaceId) throw new Error(`Risk ${id} not found`)
    if (current.version !== submittedVersion) {
      throw new StaleDraftError('risk_entry', id)
    }

    const validation = validateRisk({ ...(input as Record<string, unknown>), status: raw['status'] ?? current.status })
    if (!validation.ok) {
      throw Object.assign(new Error('Validation failed'), { errors: validation.errors })
    }
    const { title, description, category, likelihood, impact, ownerPersonId, treatment, status, reviewDate, frameworkId } = validation.value
    const severity = severityBucket(likelihood, impact)

    const updated = await store.update(id, {
      title,
      description: description ?? null,
      category: category ?? null,
      likelihood,
      impact,
      severity,
      owner_person_id: ownerPersonId ?? null,
      treatment: treatment ?? null,
      status: status ?? current.status,
      review_date: reviewDate ?? null,
      framework_id: frameworkId ?? null,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })

    await publish({
      workspace_id: ctx.workspaceId,
      type: 'risk.updated',
      entity_type: 'risk_entry',
      entity_id: id,
      after: updated,
      actor: ctx.userId,
    })

    return updated
  }

  async function close(ctx: RiskServiceContext, id: string): Promise<RiskRow> {
    const current = await store.getById(id)
    if (!current) throw new Error(`Risk ${id} not found`)
    if (current.workspace_id !== ctx.workspaceId) throw new Error(`Risk ${id} not found`)

    const updated = await store.update(id, {
      status: 'closed',
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })

    await publish({
      workspace_id: ctx.workspaceId,
      type: 'risk.closed',
      entity_type: 'risk_entry',
      entity_id: id,
      after: updated,
      actor: ctx.userId,
    })

    return updated
  }

  async function linkRule(ctx: RiskServiceContext, riskId: string, ruleId: string): Promise<void> {
    await links.connect(linkStore, {
      workspace_id: ctx.workspaceId,
      from: { type: 'risk_entry', id: riskId },
      to: { type: 'business_rule', id: ruleId },
      relation: 'addresses',
    })
  }

  return { list, create, update, close, linkRule }
}
