// Mirrors server/src/modules/onboarding/anzsic-catalogue.ts — keep in sync

export const ANZSIC_OPTIONS = [
  { code: '7000', label: 'Computer System Design and Related Services' },
  { code: '6932', label: 'Accounting Services' },
  { code: '6962', label: 'Management Advice and Related Consulting Services' },
  { code: '4279', label: 'Other Store-Based Retailing n.e.c.' },
  { code: '4511', label: 'Cafes and Restaurants' },
  { code: '8601', label: 'Aged Care Residential Services' },
] as const

export type AnzsicCode = (typeof ANZSIC_OPTIONS)[number]['code']

const DISCLAIMER =
  'General setup guidance only—not legal advice. Verify each obligation before activation.'

export interface ObligationSuggestion {
  title: string
  description: string
  source: 'custom'
  status: 'draft'
  subscribe_updates: false
}

const SUGGESTIONS: Record<AnzsicCode, ObligationSuggestion[]> = {
  '7000': [
    {
      title: 'Data Privacy Policy',
      description: `Maintain a documented data privacy policy covering client data handling. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Software Licensing Compliance',
      description: `Track and renew all software licences used in service delivery. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Incident Response Plan',
      description: `Maintain and test a cybersecurity incident response plan. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
  ],
  '6932': [
    {
      title: 'Professional Indemnity Insurance',
      description: `Maintain current professional indemnity insurance coverage. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Client Engagement Letters',
      description: `Issue signed engagement letters before commencing client work. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'AML/CTF Register',
      description: `Keep an up-to-date anti-money-laundering customer register. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
  ],
  '6962': [
    {
      title: 'Conflicts of Interest Register',
      description: `Document and manage conflicts of interest for all engagements. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Confidentiality Agreements',
      description: `Ensure NDAs are in place before receiving client confidential information. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
  ],
  '4279': [
    {
      title: 'Product Safety Compliance',
      description: `Verify all products meet mandatory safety standards before sale. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Consumer Guarantee Policy',
      description: `Maintain a consumer guarantees policy aligned with Australian Consumer Law or NZ Consumer Law. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
  ],
  '4511': [
    {
      title: 'Food Safety Plan',
      description: `Maintain and review a documented food safety plan. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Liquor Licence Renewal',
      description: `Track liquor licence expiry and renewal requirements. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Allergen Disclosure',
      description: `Display accurate allergen information on menus and at point of service. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
  ],
  '8601': [
    {
      title: 'Accreditation Compliance',
      description: `Maintain aged care accreditation and respond to any audit findings within required timeframes. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Mandatory Reporting',
      description: `Establish procedures for mandatory reporting of reportable incidents and assaults. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
    {
      title: 'Resident Care Plans',
      description: `Review and update individual resident care plans at the required intervals. ${DISCLAIMER}`,
      source: 'custom',
      status: 'draft',
      subscribe_updates: false,
    },
  ],
}

export function obligationSuggestionsFor(code: string): ObligationSuggestion[] {
  return SUGGESTIONS[code as AnzsicCode] ?? []
}
