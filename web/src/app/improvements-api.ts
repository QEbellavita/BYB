import { apiFetch } from '../api'

export interface Improvement {
  id: string
  source: 'auto' | 'manual'
  title: string
  detail: string | null
  trigger_kind: string | null
  source_ref: string | null
  suggested_change: string | null
  status: 'open' | 'actioned' | 'dismissed' | 'done'
  assignee_person_id: string | null
  version: number
}

export interface CreateImprovementInput {
  title: string
  detail?: string
  suggested_change?: string
}

export interface ImprovementsApi {
  list(): Promise<Improvement[]>
  create(input: CreateImprovementInput): Promise<Improvement>
  setStatus(id: string, status: Improvement['status']): Promise<Improvement>
}

export function improvementsApi(token: string, workspaceId: string): ImprovementsApi {
  return {
    list: () =>
      apiFetch<Improvement[]>('/api/m/improvements/improvements', token, { workspaceId }),

    create: (input: CreateImprovementInput) =>
      apiFetch<Improvement>('/api/m/improvements/improvements', token, {
        method: 'POST',
        workspaceId,
        body: input,
      }),

    setStatus: (id: string, status: Improvement['status']) =>
      apiFetch<Improvement>(`/api/m/improvements/improvements/${id}/status`, token, {
        method: 'POST',
        workspaceId,
        body: { status },
      }),
  }
}
