import { hubRepository } from './hub-repository.js'
import type { HubRow } from './types.js'

export type BusinessProfile = HubRow & { name: string; anzsic_code: string | null; jurisdiction: 'AU' | 'NZ' | null }
export type BusinessRule = HubRow & { rule_type: string; area: string; statement: string; value: unknown; consequence: string | null; applies_to: string[] }
export type ComplianceObligation = HubRow & { name: string; source: string | null }
export type InternalProcess = HubRow & { title: string; steps: unknown[] }
export type DecisionLogic = HubRow & { name: string; logic: unknown }
export type RiskFramework = HubRow & { name: string; matrix_config: unknown }
export type Governance = HubRow & { name: string; kind: string }
export type OrgPerson = HubRow & { person_name: string; email: string | null; responsibilities: unknown[] }

export const profile = hubRepository<BusinessProfile>('business_profile')
export const rules = hubRepository<BusinessRule>('business_rules')
export const obligations = hubRepository<ComplianceObligation>('compliance_obligations')
export const processes = hubRepository<InternalProcess>('internal_processes')
export const decisionLogic = hubRepository<DecisionLogic>('decision_logic')
export const riskFrameworks = hubRepository<RiskFramework>('risk_frameworks')
export const governance = hubRepository<Governance>('governance')
export const people = hubRepository<OrgPerson>('org_people')
