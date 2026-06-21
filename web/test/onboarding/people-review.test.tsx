import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PeopleStep } from '../../src/onboarding/steps/PeopleStep'
import { ReviewStep } from '../../src/onboarding/steps/ReviewStep'
import type { OnboardingSnapshot, RuleInput } from '../../src/onboarding/types'

function fakeSnapshot(overrides?: Partial<OnboardingSnapshot>): OnboardingSnapshot {
  return {
    session: {
      id: 's1',
      workspace_id: 'w1',
      user_id: 'u1',
      current_step: 'review',
      completed_steps: ['profile', 'rules', 'industry', 'people'],
      created_at: '',
      updated_at: '',
    },
    profile: null,
    rules: [],
    obligations: [],
    people: [],
    ...overrides,
  }
}

function fakeApi(overrides?: Record<string, unknown>) {
  return {
    bootstrap: vi.fn(async () => ({ workspaces: [] })),
    createWorkspace: vi.fn(async () => ({ workspaceId: 'w1' })),
    load: vi.fn(async () => fakeSnapshot()),
    saveProfile: vi.fn(async () => fakeSnapshot()),
    saveRules: vi.fn(async () => fakeSnapshot()),
    saveIndustry: vi.fn(async () => fakeSnapshot()),
    savePeople: vi.fn(async () => fakeSnapshot()),
    finish: vi.fn(async () => ({
      workspaceId: 'w1',
      completedAt: '',
      invitesSent: 1,
      invitesFailed: 0,
    })),
    ...overrides,
  }
}

describe('PeopleStep', () => {
  it('rejects duplicate emails case-insensitively and shows inline error', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    render(
      <PeopleStep
        token="tok"
        workspaceId="w1"
        api={api}
        onSave={vi.fn()}
        currentUserEmail="owner@example.com"
      />,
    )

    // Add a person first
    await user.type(screen.getByLabelText(/name/i), 'Alice')
    await user.type(screen.getByLabelText(/email/i), 'Alice@Example.com')
    await user.click(screen.getByRole('button', { name: /add person/i }))

    // Try to add another person with same email (different case)
    await user.type(screen.getByLabelText(/email/i), 'alice@example.com')
    await user.click(screen.getByRole('button', { name: /add person/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/duplicate email/i)
    expect(api.savePeople).not.toHaveBeenCalled()
  })

  it('invite toggle shows "Invitation sends when you finish setup"', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    render(
      <PeopleStep
        token="tok"
        workspaceId="w1"
        api={api}
        onSave={vi.fn()}
        currentUserEmail="owner@example.com"
      />,
    )

    // Add a person with invite enabled
    await user.type(screen.getByLabelText(/name/i), 'Bob')
    await user.type(screen.getByLabelText(/email/i), 'bob@example.com')
    // Toggle invite on — default state is unchecked, click unconditionally
    const inviteToggle = screen.getByLabelText(/invite/i)
    await user.click(inviteToggle)
    await user.click(screen.getByRole('button', { name: /add person/i }))

    expect(screen.getByText(/Invitation sends when you finish setup/)).toBeInTheDocument()
  })

  it('calls savePeople on save', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const onSave = vi.fn()

    render(
      <PeopleStep
        token="tok"
        workspaceId="w1"
        api={api}
        onSave={onSave}
        currentUserEmail="owner@example.com"
      />,
    )

    // Add a person
    await user.type(screen.getByLabelText(/name/i), 'Carol')
    await user.type(screen.getByLabelText(/email/i), 'carol@example.com')
    await user.click(screen.getByRole('button', { name: /add person/i }))

    // Save
    await user.click(screen.getByRole('button', { name: /save.*continue/i }))

    await waitFor(() => {
      expect(api.savePeople).toHaveBeenCalled()
    })
  })

  it('owner row has no Remove button; non-owner rows do', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const OWNER_EMAIL = 'owner@example.com'

    render(
      <PeopleStep
        token="tok"
        workspaceId="w1"
        api={api}
        onSave={vi.fn()}
        currentUserEmail={OWNER_EMAIL}
      />,
    )

    // Add owner (matching currentUserEmail)
    await user.type(screen.getByLabelText(/name/i), 'Owner Person')
    await user.type(screen.getByLabelText(/email/i), OWNER_EMAIL)
    await user.click(screen.getByRole('button', { name: /add person/i }))

    // Add a non-owner
    await user.type(screen.getByLabelText(/name/i), 'Staff Member')
    await user.type(screen.getByLabelText(/email/i), 'staff@example.com')
    await user.click(screen.getByRole('button', { name: /add person/i }))

    // Find all rendered list items (people rows)
    const listItems = screen.getAllByRole('listitem')

    // Owner row: the one containing the owner email — should have NO Remove button
    const ownerItem = listItems.find((li) => li.textContent?.includes(OWNER_EMAIL))
    expect(ownerItem).toBeDefined()
    const ownerRemove = ownerItem!.querySelector('button')
    expect(ownerRemove).toBeNull()

    // Non-owner row: should have a Remove button
    const staffItem = listItems.find((li) => li.textContent?.includes('staff@example.com'))
    expect(staffItem).toBeDefined()
    expect(staffItem!.querySelector('button')).not.toBeNull()
  })
})

describe('ReviewStep', () => {
  it('renders three sections: Activates now, Remains draft, Emails after completion', () => {
    const snap = fakeSnapshot({
      obligations: [
        { id: 'o1', name: 'Policy A', description: 'Desc A', status: 'active' },
        { id: 'o2', name: 'Policy B', description: 'Desc B', status: 'draft' },
      ],
      people: [
        { id: 'p1', personName: 'Alice', email: 'alice@example.com', invite: true, role: 'admin' },
      ],
    })
    const api = fakeApi()

    render(
      <ReviewStep
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        api={api}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText(/Activates now/i)).toBeInTheDocument()
    expect(screen.getByText(/Remains draft/i)).toBeInTheDocument()
    expect(screen.getByText(/Emails after completion/i)).toBeInTheDocument()
  })

  it('Finish button is disabled until confirmation checkbox is checked', async () => {
    const user = userEvent.setup()
    const snap = fakeSnapshot()
    const api = fakeApi()

    render(
      <ReviewStep
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        api={api}
        onComplete={vi.fn()}
      />,
    )

    const finishBtn = screen.getByRole('button', { name: /finish/i })
    expect(finishBtn).toBeDisabled()

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    expect(finishBtn).not.toBeDisabled()
  })

  it('on successful Finish calls onComplete', async () => {
    const user = userEvent.setup()
    const snap = fakeSnapshot()
    const api = fakeApi()
    const onComplete = vi.fn()

    render(
      <ReviewStep
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        api={api}
        onComplete={onComplete}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    const finishBtn = screen.getByRole('button', { name: /finish/i })
    await user.click(finishBtn)

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled()
    })
  })

  it('failed Finish leaves Review screen and all data intact', async () => {
    const user = userEvent.setup()
    const snap = fakeSnapshot({
      obligations: [
        { id: 'o1', name: 'Policy A', description: 'Desc A', status: 'active' },
      ],
    })
    const api = fakeApi({
      finish: vi.fn(async () => {
        throw new Error('Server error')
      }),
    })
    const onComplete = vi.fn()

    render(
      <ReviewStep
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        api={api}
        onComplete={onComplete}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    const finishBtn = screen.getByRole('button', { name: /finish/i })
    await user.click(finishBtn)

    await waitFor(() => {
      // Still on review screen — all three sections still visible
      expect(screen.getByText(/Activates now/i)).toBeInTheDocument()
      expect(screen.getByText(/Remains draft/i)).toBeInTheDocument()
      expect(screen.getByText(/Emails after completion/i)).toBeInTheDocument()
      // onComplete NOT called
      expect(onComplete).not.toHaveBeenCalled()
    })
  })

  it('Finish button is disabled when snapshot contains divergent rules, even after checkbox checked', async () => {
    const user = userEvent.setup()
    const divergentRules: RuleInput[] = [
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
    const snap = fakeSnapshot({ rules: divergentRules as unknown as Record<string, unknown>[] })
    const api = fakeApi()

    render(
      <ReviewStep
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        api={api}
        onComplete={vi.fn()}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    // Even with checkbox checked, Finish must remain disabled due to divergent conflict
    const finishBtn = screen.getByRole('button', { name: /finish/i })
    expect(finishBtn).toBeDisabled()
  })

  it('Finish button is enabled when checkbox checked and no divergent conflicts', async () => {
    const user = userEvent.setup()
    const nonConflictingRules: RuleInput[] = [
      {
        ruleType: 'business_rule',
        area: 'HR',
        statement: 'All employees must have a contract',
        operator: null,
        value: null,
        consequence: 'Disciplinary action',
        appliesTo: ['all staff'],
      },
    ]
    const snap = fakeSnapshot({ rules: nonConflictingRules as unknown as Record<string, unknown>[] })
    const api = fakeApi()

    render(
      <ReviewStep
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        api={api}
        onComplete={vi.fn()}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    const finishBtn = screen.getByRole('button', { name: /finish/i })
    expect(finishBtn).not.toBeDisabled()
  })
})
