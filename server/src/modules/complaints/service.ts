import { StaleDraftError } from '../../errors.js'
import { validateComplaint } from './validation.js'
import type { ComplaintRow, ComplaintStore, ComplaintService, ComplaintServiceContext } from './types.js'
import type { Publish } from '../../events/publish.js'
import type { LinkStore } from '../../context/links.js'
import { links as linksUtils } from '../../context/links.js'

interface ServiceDeps {
  store: ComplaintStore
  publish: Publish
  links: typeof linksUtils
  linkStore: LinkStore
}

export function createComplaintsService(deps: ServiceDeps): ComplaintService {
  const { store, publish, links, linkStore } = deps

  async function list(ctx: ComplaintServiceContext): Promise<ComplaintRow[]> {
    return store.list(ctx.workspaceId)
  }

  async function create(ctx: ComplaintServiceContext, input: unknown): Promise<ComplaintRow> {
    const validation = validateComplaint(input)
    if (!validation.ok) {
      throw Object.assign(new Error('Validation failed'), { errors: validation.errors })
    }
    const { description, channel, severity, category, customerId, notes } = validation.value

    const n = (await store.countForWorkspace(ctx.workspaceId)) + 1
    const reference = 'C-' + String(n).padStart(3, '0')

    const row = await store.create({
      workspace_id: ctx.workspaceId,
      reference,
      description,
      channel: channel ?? null,
      severity: severity ?? 'low',
      status: 'new',
      category: category ?? null,
      customer_id: customerId ?? null,
      notes: notes ?? null,
      resolved_at: null,
      received_at: new Date().toISOString(),
    })

    await publish({
      workspace_id: ctx.workspaceId,
      type: 'complaint.created',
      entity_type: 'complaint',
      entity_id: row.id,
      after: row,
      actor: ctx.userId,
    })

    return row
  }

  async function update(ctx: ComplaintServiceContext, id: string, input: unknown): Promise<ComplaintRow> {
    const raw = input as Record<string, unknown>
    const submittedVersion = raw['version'] as number | undefined

    if (submittedVersion === undefined) {
      throw Object.assign(new Error('Validation failed'), { errors: { version: 'Required for update' } })
    }

    const current = await store.getById(id)
    if (!current) throw new Error(`Complaint ${id} not found`)
    if (current.workspace_id !== ctx.workspaceId) throw new Error(`Complaint ${id} not found`)
    if (current.version !== submittedVersion) {
      throw new StaleDraftError('complaint', id)
    }

    const validation = validateComplaint(input)
    if (!validation.ok) {
      throw Object.assign(new Error('Validation failed'), { errors: validation.errors })
    }
    const { description, channel, severity, customerId, notes } = validation.value

    const updated = await store.update(id, {
      description,
      channel: channel ?? null,
      severity: severity ?? current.severity,
      // status is NOT a field editable via update(); it is managed by dedicated transitions
      status: current.status,
      customer_id: customerId ?? null,
      notes: notes ?? null,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })

    await publish({
      workspace_id: ctx.workspaceId,
      type: 'complaint.updated',
      entity_type: 'complaint',
      entity_id: id,
      after: updated,
      actor: ctx.userId,
    })

    return updated
  }

  async function resolve(ctx: ComplaintServiceContext, id: string): Promise<ComplaintRow> {
    const current = await store.getById(id)
    if (!current) throw new Error(`Complaint ${id} not found`)
    if (current.workspace_id !== ctx.workspaceId) throw new Error(`Complaint ${id} not found`)

    if (current.status === 'resolved' || current.status === 'closed') {
      throw new Error(`Cannot resolve a complaint that is already ${current.status}`)
    }

    const updated = await store.update(id, {
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })

    await publish({
      workspace_id: ctx.workspaceId,
      type: 'complaint.resolved',
      entity_type: 'complaint',
      entity_id: id,
      after: updated,
      actor: ctx.userId,
    })

    return updated
  }

  async function linkRule(ctx: ComplaintServiceContext, complaintId: string, ruleId: string): Promise<void> {
    await links.connect(linkStore, {
      workspace_id: ctx.workspaceId,
      from: { type: 'complaint', id: complaintId },
      to: { type: 'business_rule', id: ruleId },
      relation: 'concerns',
    })
  }

  async function linkProcess(ctx: ComplaintServiceContext, complaintId: string, processId: string): Promise<void> {
    await links.connect(linkStore, {
      workspace_id: ctx.workspaceId,
      from: { type: 'complaint', id: complaintId },
      to: { type: 'internal_process', id: processId },
      relation: 'concerns',
    })
  }

  return { list, create, update, resolve, linkRule, linkProcess }
}
