import type { HubRow, HubStore } from './types.js'

export function hubRepository<T extends HubRow>(table: string) {
  return {
    list: (store: HubStore, workspaceId: string, filters: Record<string, unknown> = {}) =>
      store.select(table, { workspace_id: workspaceId, ...filters }) as Promise<T[]>,
    get: (store: HubStore, id: string) => store.getById(table, id) as Promise<T | null>,
    upsert: (store: HubStore, input: Record<string, unknown> & { id?: string }) => {
      const { id, ...rest } = input
      return (id ? store.update(table, id, rest) : store.insert(table, rest)) as Promise<T>
    },
    approve: (store: HubStore, id: string) => store.update(table, id, { status: 'active' }) as Promise<T>,
    deprecate: (store: HubStore, id: string) => store.update(table, id, { status: 'archived' }) as Promise<T>,
  }
}
