import { apiFetch } from '../api'

export interface Risk {
  id: string
  title: string
  description: string | null
  category: string | null
  likelihood: number
  impact: number
  owner_person_id: string | null
  treatment: string | null
  status: string
  review_date: string | null
  framework_id: string | null
  version: number
}

export interface CreateRiskInput {
  title: string
  likelihood: number
  impact: number
  description?: string
  category?: string
  ownerPersonId?: string
  treatment?: string
  reviewDate?: string
  frameworkId?: string
}

export interface UpdateRiskInput extends CreateRiskInput {
  version: number
}

export interface RiskApi {
  list(): Promise<Risk[]>
  create(input: CreateRiskInput): Promise<Risk>
  update(id: string, input: UpdateRiskInput): Promise<Risk>
  close(id: string): Promise<Risk>
}

export function riskApi(token: string, workspaceId: string): RiskApi {
  return {
    list: () =>
      apiFetch<{ risks: Risk[] }>('/api/m/risk/risks', token, { workspaceId }).then((r) => r.risks),

    create: (input: CreateRiskInput) =>
      apiFetch<Risk>('/api/m/risk/risks', token, {
        method: 'POST',
        workspaceId,
        body: input,
      }),

    update: (id: string, input: UpdateRiskInput) =>
      apiFetch<Risk>(`/api/m/risk/risks/${id}`, token, {
        method: 'PUT',
        workspaceId,
        body: input,
      }),

    close: (id: string) =>
      apiFetch<Risk>(`/api/m/risk/risks/${id}/close`, token, {
        method: 'POST',
        workspaceId,
      }),
  }
}
