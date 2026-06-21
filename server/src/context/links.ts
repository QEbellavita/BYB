export interface LinkRef { type: string; id: string }
export interface ContextLink {
  id: string; workspace_id: string
  from_type: string; from_id: string; to_type: string; to_id: string
  relation: string | null; created_at: string
}
export interface LinkStore {
  insertLink(row: Record<string, unknown>): Promise<ContextLink>
  selectLinks(workspaceId: string, ref?: LinkRef): Promise<ContextLink[]>
  deleteLink(id: string): Promise<void>
}

export const links = {
  connect: (store: LinkStore, link: { workspace_id: string; from: LinkRef; to: LinkRef; relation?: string }) =>
    store.insertLink({
      workspace_id: link.workspace_id,
      from_type: link.from.type, from_id: link.from.id,
      to_type: link.to.type, to_id: link.to.id,
      relation: link.relation ?? null,
    }),
  list: (store: LinkStore, workspaceId: string, ref?: LinkRef) => store.selectLinks(workspaceId, ref),
  disconnect: (store: LinkStore, id: string) => store.deleteLink(id),
}
