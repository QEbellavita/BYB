import type { Registry } from '../../context/events.js'
import type { RiskRow } from '../risk/types.js'
import type { AutoSuggestionRow } from './types.js'

export const RECURRING_COMPLAINTS_THRESHOLD = 3
export const RECURRING_WINDOW_DAYS = 90
export const HIGH_SEVERITY_MIN = 12

export interface SubscriberDeps {
  riskStore: {
    getById(id: string): Promise<RiskRow | null>
  }
  complaintStore: {
    getById(id: string): Promise<{ id: string; workspace_id: string; category?: string | null; status: string } | null>
    countByCategorySince(workspaceId: string, category: string, sinceIso: string): Promise<number>
  }
  improvementStore: {
    upsertAuto(row: AutoSuggestionRow): Promise<void>
    clearAuto(workspaceId: string, dedupKey: string): Promise<void>
  }
}

export function registerImprovementSubscriber(
  registry: Registry,
  deps: SubscriberDeps,
  now: () => Date,
): void {
  const { riskStore, complaintStore, improvementStore } = deps

  // Risk event handler: untreated_high_risk + overdue_risk_review
  registry.on('risk.', async (e) => {
    const risk = e.after as RiskRow | null
    if (!risk) return

    const riskId = risk.id
    const workspaceId = risk.workspace_id

    // ---- Rule: untreated_high_risk ----
    const severity = risk.likelihood * risk.impact
    const treatment = risk.treatment
    const treatmentEmpty = !treatment || treatment.trim() === ''

    if (severity >= HIGH_SEVERITY_MIN && risk.status === 'open' && treatmentEmpty) {
      await improvementStore.upsertAuto({
        workspace_id: workspaceId,
        source: 'auto',
        trigger_kind: 'untreated_high_risk',
        dedup_key: `untreated_high_risk:${riskId}`,
        title: `High-severity risk requires treatment: ${risk.title}`,
        suggested_change: 'Add a treatment plan to address this high-severity risk.',
        source_ref: { risk_id: riskId },
      })
    } else if (!treatmentEmpty || risk.status === 'closed') {
      // Treatment added or risk closed → clear the open auto suggestion
      await improvementStore.clearAuto(workspaceId, `untreated_high_risk:${riskId}`)
    }

    // ---- Rule: overdue_risk_review ----
    if (risk.review_date && risk.status !== 'closed') {
      const today = now().toISOString().slice(0, 10) // YYYY-MM-DD
      if (risk.review_date < today) {
        await improvementStore.upsertAuto({
          workspace_id: workspaceId,
          source: 'auto',
          trigger_kind: 'overdue_risk_review',
          dedup_key: `overdue_risk_review:${riskId}`,
          title: `Risk review overdue: ${risk.title}`,
          suggested_change: `Risk review was due on ${risk.review_date}. Schedule a review immediately.`,
          source_ref: { risk_id: riskId },
        })
      }
    }
  })

  // Complaint event handler: recurring_complaints
  registry.on('complaint.', async (e) => {
    const complaint = e.after as { id: string; workspace_id: string; category?: string | null; status?: string } | null
    if (!complaint) return

    const category = complaint.category
    if (!category) return // Skip if no category

    const workspaceId = complaint.workspace_id

    // Compute the window start
    const sinceIso = new Date(now().getTime() - RECURRING_WINDOW_DAYS * 864e5).toISOString()

    const count = await complaintStore.countByCategorySince(workspaceId, category, sinceIso)

    if (count >= RECURRING_COMPLAINTS_THRESHOLD) {
      await improvementStore.upsertAuto({
        workspace_id: workspaceId,
        source: 'auto',
        trigger_kind: 'recurring_complaints',
        dedup_key: `recurring_complaints:${category}`,
        title: `Recurring complaints in category: ${category}`,
        suggested_change: `${count} complaints in category "${category}" in the last ${RECURRING_WINDOW_DAYS} days. Investigate root cause.`,
        source_ref: { category },
      })
    }
  })
}
