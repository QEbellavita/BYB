import { apiFetch } from '../api'

export interface Complaint {
  id: string
  reference: string
  complainant_name: string | null
  complainant_contact: string | null
  channel: string | null
  received_at: string
  description: string
  category: string | null
  severity: string | null
  assignee_person_id: string | null
  status: 'new' | 'in_progress' | 'resolved' | 'closed'
  resolution_notes: string | null
  resolved_at: string | null
  version: number
}

export interface CreateComplaintInput {
  description: string
  category?: string
  channel?: string
  severity?: string
  complainant_name?: string
  complainant_contact?: string
}

export interface UpdateComplaintInput extends CreateComplaintInput {
  version: number
}

export interface ComplaintsApi {
  list(): Promise<Complaint[]>
  create(input: CreateComplaintInput): Promise<Complaint>
  update(id: string, input: UpdateComplaintInput): Promise<Complaint>
  resolve(id: string): Promise<Complaint>
}

export function complaintsApi(token: string, workspaceId: string): ComplaintsApi {
  return {
    list: () =>
      apiFetch<Complaint[]>('/api/m/complaints/complaints', token, { workspaceId }),

    create: (input: CreateComplaintInput) =>
      apiFetch<Complaint>('/api/m/complaints/complaints', token, {
        method: 'POST',
        workspaceId,
        body: input,
      }),

    update: (id: string, input: UpdateComplaintInput) =>
      apiFetch<Complaint>(`/api/m/complaints/complaints/${id}`, token, {
        method: 'PUT',
        workspaceId,
        body: input,
      }),

    resolve: (id: string) =>
      apiFetch<Complaint>(`/api/m/complaints/complaints/${id}/resolve`, token, {
        method: 'POST',
        workspaceId,
      }),
  }
}
