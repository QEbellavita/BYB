import * as entities from './entities.js'
import { links } from './links.js'
import { ruleConflicts } from './conflicts.js'

export const ContextHub = {
  profile: entities.profile,
  rules: Object.assign({}, entities.rules, { conflicts: ruleConflicts }),
  obligations: entities.obligations,
  processes: entities.processes,
  decisionLogic: entities.decisionLogic,
  riskFrameworks: entities.riskFrameworks,
  governance: entities.governance,
  people: entities.people,
  links,
}

export * from './types.js'
export * from './entities.js'
export * from './links.js'
export * from './conflicts.js'
export * from './supabase-store.js'
export * from './events.js'
