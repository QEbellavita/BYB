export type MemberRole =
  | 'owner' | 'admin' | 'manager' | 'compliance_officer' | 'accountant' | 'staff'

export interface MemberPermissions { granted?: string[]; revoked?: string[] }
export interface MemberLike { role: string; permissions: MemberPermissions }

// '*' is a wildcard meaning "all permissions".
export const roleDefaults: Record<MemberRole, string[]> = {
  owner: ['*'],
  admin: ['*'],
  manager: ['process.read', 'process.write', 'risk.read', 'risk.write', 'complaint.read', 'complaint.write', 'people.read'],
  compliance_officer: ['obligations.read', 'obligations.write', 'process.read', 'risk.read', 'risk.write'],
  accountant: ['finance.read', 'finance.write', 'reporting.read'],
  staff: ['process.read', 'document.read', 'training.read', 'training.complete'],
}

export function resolvePermissions(member: MemberLike): Set<string> {
  const base = roleDefaults[(member.role as MemberRole)] ?? []
  const set = new Set<string>(base)
  for (const g of member.permissions.granted ?? []) set.add(g)
  for (const r of member.permissions.revoked ?? []) set.delete(r)
  return set
}
