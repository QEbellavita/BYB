import { StaleDraftError } from '../../errors.js'
import { validateImprovement } from './validation.js'
import type { ImprovementRow, ImprovementStore, ImprovementService, ImprovementServiceContext, ImprovementStatus } from './types.js'

const VALID_STATUSES: ImprovementStatus[] = ['open', 'actioned', 'dismissed', 'done']

interface ServiceDeps {
  store: ImprovementStore
}

export function createImprovementService(deps: ServiceDeps): ImprovementService {
  const { store } = deps

  async function list(ctx: ImprovementServiceContext, status?: string): Promise<ImprovementRow[]> {
    const validStatus = status && VALID_STATUSES.includes(status as ImprovementStatus)
      ? (status as ImprovementStatus)
      : undefined
    return store.list(ctx.workspaceId, validStatus)
  }

  async function create(ctx: ImprovementServiceContext, input: unknown): Promise<ImprovementRow> {
    const validation = validateImprovement(input)
    if (!validation.ok) {
      throw Object.assign(new Error('Validation failed'), { errors: validation.errors })
    }
    const { title, suggested_change, detail } = validation.value

    return store.create({
      workspace_id: ctx.workspaceId,
      title,
      suggested_change: suggested_change ?? null,
      detail: detail ?? null,
      source: 'manual',
      status: 'open',
      trigger_kind: null,
      dedup_key: null,
      source_ref: null,
    })
  }

  async function update(ctx: ImprovementServiceContext, id: string, input: unknown): Promise<ImprovementRow> {
    const raw = input as Record<string, unknown>
    const submittedVersion = raw['version'] as number | undefined

    if (submittedVersion === undefined) {
      throw Object.assign(new Error('Validation failed'), { errors: { version: 'Required for update' } })
    }

    const current = await store.getById(id)
    if (!current) throw new Error(`Improvement ${id} not found`)
    if (current.workspace_id !== ctx.workspaceId) throw new Error(`Improvement ${id} not found`)
    if (current.version !== submittedVersion) {
      throw new StaleDraftError('improvement', id)
    }

    const validation = validateImprovement(input)
    if (!validation.ok) {
      throw Object.assign(new Error('Validation failed'), { errors: validation.errors })
    }
    const { title, suggested_change, detail } = validation.value

    return store.update(id, {
      title,
      suggested_change: suggested_change ?? null,
      detail: detail ?? null,
      // status is managed by setStatus only
      status: current.status,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })
  }

  async function setStatus(ctx: ImprovementServiceContext, id: string, status: string): Promise<ImprovementRow> {
    if (!VALID_STATUSES.includes(status as ImprovementStatus)) {
      throw Object.assign(new Error('Validation failed'), {
        errors: { status: `Must be one of: ${VALID_STATUSES.join(', ')}` },
      })
    }

    const current = await store.getById(id)
    if (!current) throw new Error(`Improvement ${id} not found`)
    if (current.workspace_id !== ctx.workspaceId) throw new Error(`Improvement ${id} not found`)

    return store.update(id, {
      status: status as ImprovementStatus,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })
  }

  return { list, create, update, setStatus }
}
