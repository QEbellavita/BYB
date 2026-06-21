import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingWizard } from '../../src/onboarding/OnboardingWizard'
import type { OnboardingSnapshot, OnboardingStep } from '../../src/onboarding/types'

function fakeSnapshot(
  currentStep: OnboardingStep,
  completedSteps: OnboardingStep[],
): OnboardingSnapshot {
  return {
    session: {
      id: 's1',
      workspace_id: 'w1',
      user_id: 'u1',
      current_step: currentStep,
      completed_steps: completedSteps,
      created_at: '',
      updated_at: '',
    },
    profile: null,
    rules: [],
    obligations: [],
    people: [],
  }
}

function fakeApi(overrides?: Partial<ReturnType<typeof import('../../src/onboarding/api').onboardingApi>>) {
  const defaultSnapshot = fakeSnapshot('rules', ['profile'])
  return {
    bootstrap: vi.fn(async () => ({ workspaces: [] })),
    createWorkspace: vi.fn(async () => ({ workspaceId: 'w1' })),
    load: vi.fn(async () => defaultSnapshot),
    saveProfile: vi.fn(async () => defaultSnapshot),
    saveRules: vi.fn(async () => fakeSnapshot('industry', ['profile', 'rules'])),
    saveIndustry: vi.fn(async () => fakeSnapshot('people', ['profile', 'rules', 'industry'])),
    savePeople: vi.fn(async () => fakeSnapshot('review', ['profile', 'rules', 'industry', 'people'])),
    finish: vi.fn(async () => ({ workspaceId: 'w1', completedAt: '', invitesSent: 0, invitesFailed: 0 })),
    ...overrides,
  }
}

describe('OnboardingWizard', () => {
  it('nav present: renders navigation with onboarding progress label', () => {
    const snap = fakeSnapshot('profile', [])
    const api = fakeApi()
    render(
      <OnboardingWizard
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        onWorkspaceCreated={vi.fn()}
        onComplete={vi.fn()}
        api={api}
      />,
    )
    expect(screen.getByRole('navigation', { name: /onboarding progress/i })).toBeInTheDocument()
  })

  it('cannot click People when Profile incomplete', () => {
    const snap = fakeSnapshot('profile', [])
    const api = fakeApi()
    render(
      <OnboardingWizard
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        onWorkspaceCreated={vi.fn()}
        onComplete={vi.fn()}
        api={api}
      />,
    )
    const peopleBtn = screen.getByRole('button', { name: /people/i })
    expect(peopleBtn).toBeDisabled()
  })

  it('can revisit Profile after completion', () => {
    const snap = fakeSnapshot('rules', ['profile'])
    const api = fakeApi()
    render(
      <OnboardingWizard
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        onWorkspaceCreated={vi.fn()}
        onComplete={vi.fn()}
        api={api}
      />,
    )
    const profileBtn = screen.getByRole('button', { name: /profile/i })
    expect(profileBtn).not.toBeDisabled()
  })

  it('shows "Saving…" then "Saved" after profile submit', async () => {
    const user = userEvent.setup()
    let resolve!: (v: OnboardingSnapshot) => void
    const delayedSaveProfile = vi.fn(
      () => new Promise<OnboardingSnapshot>((res) => { resolve = res }),
    )
    const api = fakeApi({ saveProfile: delayedSaveProfile })
    const snap = fakeSnapshot('profile', [])

    render(
      <OnboardingWizard
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        onWorkspaceCreated={vi.fn()}
        onComplete={vi.fn()}
        api={api}
      />,
    )

    // Fill in required profile fields
    await user.type(screen.getByLabelText(/business name/i), 'Acme')
    await user.selectOptions(screen.getByLabelText(/jurisdiction/i), 'AU')
    await user.type(screen.getByLabelText(/size/i), '10')
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Should show saving
    expect(screen.getByText(/saving/i)).toBeInTheDocument()

    // Resolve the promise
    act(() => resolve(fakeSnapshot('rules', ['profile'])))

    await waitFor(() => {
      expect(screen.getByText(/saved/i)).toBeInTheDocument()
    })
  })

  it('retains values on rejected save', async () => {
    const user = userEvent.setup()
    const api = fakeApi({
      saveProfile: vi.fn(async () => { throw new Error('Network error') }),
    })
    const snap = fakeSnapshot('profile', [])

    render(
      <OnboardingWizard
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        onWorkspaceCreated={vi.fn()}
        onComplete={vi.fn()}
        api={api}
      />,
    )

    await user.type(screen.getByLabelText(/business name/i), 'RetainMe')
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      // Values should still be in the form after rejected save
      expect(screen.getByDisplayValue('RetainMe')).toBeInTheDocument()
    })
  })

  it('rules step renders "How does your business operate?" heading', () => {
    const snap = fakeSnapshot('rules', ['profile'])
    const api = fakeApi()
    render(
      <OnboardingWizard
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        onWorkspaceCreated={vi.fn()}
        onComplete={vi.fn()}
        api={api}
      />,
    )
    expect(screen.getByRole('navigation', { name: /onboarding progress/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /how does your business operate/i })).toBeInTheDocument()
  })

  it('profile step renders name and jurisdiction fields', () => {
    const snap = fakeSnapshot('profile', [])
    const api = fakeApi()
    render(
      <OnboardingWizard
        token="tok"
        workspaceId="w1"
        snapshot={snap}
        onWorkspaceCreated={vi.fn()}
        onComplete={vi.fn()}
        api={api}
      />,
    )
    expect(screen.getByLabelText(/business name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/jurisdiction/i)).toBeInTheDocument()
  })

  it('with no workspace, createWorkspace then saveProfile via the new workspace id', async () => {
    const user = userEvent.setup()
    const newWsId = 'ws-new-123'
    const createWorkspace = vi.fn(async () => ({ workspaceId: newWsId }))
    const saveProfile = vi.fn(async () => fakeSnapshot('rules', ['profile']))

    // Track which wsId was used for each makeApi call
    const makeApiCalls: (string | undefined)[] = []
    const makeApi = vi.fn((wsId?: string) => {
      makeApiCalls.push(wsId)
      return {
        bootstrap: vi.fn(async () => ({ workspaces: [] })),
        createWorkspace,
        load: vi.fn(async () => fakeSnapshot('profile', [])),
        saveProfile,
        saveRules: vi.fn(),
        saveIndustry: vi.fn(),
        savePeople: vi.fn(),
        finish: vi.fn(),
      }
    })

    const onWorkspaceCreated = vi.fn()

    render(
      <OnboardingWizard
        token="tok"
        workspaceId={null}
        snapshot={null}
        onWorkspaceCreated={onWorkspaceCreated}
        onComplete={vi.fn()}
        makeApi={makeApi}
      />,
    )

    await user.type(screen.getByLabelText(/business name/i), 'NewCo')
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledWith('NewCo')
      expect(onWorkspaceCreated).toHaveBeenCalledWith(newWsId)
      // saveProfile-bound api must use newWsId; assert it's called with newWsId AND
      // that every call before the newWsId call used undefined (no prior call sneaks the new id in)
      const firstNewWsIdCallIndex = makeApiCalls.indexOf(newWsId)
      expect(firstNewWsIdCallIndex).toBeGreaterThan(-1)
      expect(makeApiCalls.slice(0, firstNewWsIdCallIndex).every(id => id !== newWsId)).toBe(true)
      expect(saveProfile).toHaveBeenCalled()
    })
  })
})
