import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RulesStep } from '../../src/onboarding/steps/RulesStep'
import type { OnboardingSnapshot, RuleInput } from '../../src/onboarding/types'

function fakeSnapshot(): OnboardingSnapshot {
  return {
    session: {
      id: 's1',
      workspace_id: 'w1',
      user_id: 'u1',
      current_step: 'industry',
      completed_steps: ['profile', 'rules'],
      created_at: '',
      updated_at: '',
    },
    profile: null,
    rules: [],
    obligations: [],
    people: [],
  }
}

function fakeApi() {
  return {
    bootstrap: vi.fn(async () => ({ workspaces: [] })),
    createWorkspace: vi.fn(async () => ({ workspaceId: 'w1' })),
    load: vi.fn(async () => fakeSnapshot()),
    saveProfile: vi.fn(async () => fakeSnapshot()),
    saveRules: vi.fn(async () => fakeSnapshot()),
    saveIndustry: vi.fn(async () => fakeSnapshot()),
    savePeople: vi.fn(async () => fakeSnapshot()),
    finish: vi.fn(async () => ({ workspaceId: 'w1', completedAt: '', invitesSent: 0, invitesFailed: 0 })),
  }
}

describe('RulesStep', () => {
  it('can add a rule: fill form and click Add rule → rule appears in list', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    render(
      <RulesStep
        token="tok"
        workspaceId="w1"
        initialRules={[]}
        api={api}
        onSave={vi.fn()}
      />,
    )

    await user.selectOptions(screen.getByLabelText(/rule type/i), 'business_rule')
    await user.type(screen.getByLabelText(/area/i), 'HR')
    await user.type(screen.getByLabelText(/statement/i), 'All employees must have a contract')
    await user.type(screen.getByLabelText(/consequence/i), 'Disciplinary action')
    await user.type(screen.getByLabelText(/applies to/i), 'all staff')
    await user.click(screen.getByRole('button', { name: /add rule/i }))

    expect(screen.getByText('All employees must have a contract')).toBeInTheDocument()
  })

  it('can archive a rule: click Archive → rule removed from list', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    const initialRules: RuleInput[] = [
      {
        ruleType: 'business_rule',
        area: 'HR',
        statement: 'Rule to archive',
        operator: null,
        value: null,
        consequence: 'Some consequence',
        appliesTo: ['all'],
      },
    ]

    render(
      <RulesStep
        token="tok"
        workspaceId="w1"
        initialRules={initialRules}
        api={api}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('Rule to archive')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /archive/i }))
    expect(screen.queryByText('Rule to archive')).not.toBeInTheDocument()
  })

  it('shows divergent-conflict advisory for conflicting rules', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    const conflictingRules: RuleInput[] = [
      {
        ruleType: 'business_rule',
        area: 'Payroll',
        statement: 'Overtime rate',
        operator: null,
        value: '1.5x',
        consequence: 'Pay 1.5x',
        appliesTo: ['all staff'],
      },
      {
        ruleType: 'business_rule',
        area: 'Payroll',
        statement: 'Overtime rate',
        operator: null,
        value: '2x',
        consequence: 'Pay 2x',
        appliesTo: ['all staff'],
      },
    ]

    render(
      <RulesStep
        token="tok"
        workspaceId="w1"
        initialRules={conflictingRules}
        api={api}
        onSave={vi.fn()}
      />,
    )

    const advisory = screen.getByRole('status')
    expect(advisory).toHaveTextContent(/divergent rule/i)
  })

  it('can edit a rule: click Edit → form populates with rule values', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    const initialRules: RuleInput[] = [
      {
        ruleType: 'must_do',
        area: 'Finance',
        statement: 'Submit monthly reports',
        operator: null,
        value: null,
        consequence: 'Non-compliance penalty',
        appliesTo: ['managers'],
      },
    ]

    render(
      <RulesStep
        token="tok"
        workspaceId="w1"
        initialRules={initialRules}
        api={api}
        onSave={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /edit/i }))

    expect(screen.getByDisplayValue('Finance')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Submit monthly reports')).toBeInTheDocument()
  })
})
