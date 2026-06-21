// Demo data for the signed-in experience. Shaped like the real Context Hub
// (versioned, audited, workspace-scoped) so these views drop onto live data later.

export interface Workspace {
  name: string
  region: 'AU' | 'NZ'
  anzsic: string
  industry: string
  hubVersion: number
}

export const WORKSPACE: Workspace = {
  name: 'Coastline Plumbing Co',
  region: 'AU',
  anzsic: 'E3231',
  industry: 'Plumbing Services',
  hubVersion: 14,
}

export interface HubEntity {
  code: string
  name: string
  meta: string
  version: number
  updated: string
  status: 'good' | 'ochre' | 'danger'
}

export const ENTITIES: HubEntity[] = [
  { code: '01', name: 'Business Profile',       meta: 'ANZSIC E3231 · AU',     version: 3,  updated: '6 days ago',  status: 'good' },
  { code: '02', name: 'Business Rules',         meta: '12 rules · 0 conflicts', version: 9,  updated: '2 hours ago', status: 'good' },
  { code: '03', name: 'Compliance Obligations', meta: '37 obligations · 2 due', version: 6,  updated: 'yesterday',   status: 'ochre' },
  { code: '04', name: 'Risk Frameworks',        meta: '5×5 matrix · 8 risks',   version: 4,  updated: '3 days ago',  status: 'good' },
  { code: '05', name: 'Internal Processes',     meta: '21 processes',           version: 11, updated: '5 hours ago', status: 'good' },
  { code: '06', name: 'Decision Logic',         meta: '4 decision trees',       version: 2,  updated: '1 week ago',  status: 'good' },
  { code: '07', name: 'Governance',             meta: '6 policies',             version: 5,  updated: '4 days ago',  status: 'good' },
  { code: '08', name: 'Org & People',           meta: '14 people · 5 roles',    version: 7,  updated: 'today',       status: 'good' },
]

export interface Activity {
  actor: string
  action: string
  target: string
  version: string
  time: string
  kind: 'edit' | 'create' | 'flag'
}

export const ACTIVITY: Activity[] = [
  { actor: 'Sue Flint',   action: 'updated',  target: 'Business Rules · After-hours callout', version: 'v9',  time: '2h ago',  kind: 'edit' },
  { actor: 'System',      action: 'flagged',  target: 'Obligation due · Backflow test cert',  version: '—',   time: '5h ago',  kind: 'flag' },
  { actor: 'Mark Reedy',  action: 'finalised', target: 'Process · New site induction',        version: 'v11', time: '5h ago',  kind: 'create' },
  { actor: 'Sue Flint',   action: 'added',    target: 'Org & People · Apprentice (L2)',       version: 'v7',  time: 'today',   kind: 'create' },
  { actor: 'System',      action: 'checked',  target: 'Rule conflict scan · 0 found',         version: '—',   time: 'today',   kind: 'edit' },
]

// 5×5 risk register: [likelihood 1..5][impact 1..5] severity buckets used by the heatmap
export interface Risk {
  ref: string
  title: string
  likelihood: number // 1..5
  impact: number     // 1..5
  owner: string
  review: string
}

export const RISKS: Risk[] = [
  { ref: 'RR-01', title: 'Backflow prevention non-compliance', likelihood: 2, impact: 5, owner: 'Sue Flint',  review: 'Due in 9 days' },
  { ref: 'RR-02', title: 'After-hours callout fatigue',        likelihood: 4, impact: 3, owner: 'Mark Reedy', review: 'On track' },
  { ref: 'RR-03', title: 'Apprentice unsupervised on site',    likelihood: 3, impact: 4, owner: 'Sue Flint',  review: 'Due in 2 days' },
  { ref: 'RR-04', title: 'Asbestos exposure (pre-1990 sites)', likelihood: 2, impact: 5, owner: 'Mark Reedy', review: 'On track' },
  { ref: 'RR-05', title: 'Late supplier — fittings shortage',  likelihood: 4, impact: 2, owner: 'Jo Tana',    review: 'On track' },
  { ref: 'RR-06', title: 'Invoice dispute / non-payment',      likelihood: 3, impact: 2, owner: 'Jo Tana',    review: 'On track' },
]

export const HUB_HEALTH = [
  { k: 'Modules live',   v: '8', sub: 'of 9 available', status: 'good' as const },
  { k: 'Rule conflicts', v: '0', sub: 'last scan today', status: 'good' as const },
  { k: 'Obligations due', v: '2', sub: 'next 14 days',  status: 'ochre' as const },
  { k: 'Hub version',    v: 'v14', sub: 'audited',       status: 'good' as const },
]
