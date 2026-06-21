import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndustryStep } from '../../src/onboarding/steps/IndustryStep'
import type { OnboardingSnapshot } from '../../src/onboarding/types'

function fakeSnapshot(): OnboardingSnapshot {
  return {
    session: {
      id: 's1',
      workspace_id: 'w1',
      user_id: 'u1',
      current_step: 'people',
      completed_steps: ['profile', 'rules', 'industry'],
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
    finish: vi.fn(async () => ({
      workspaceId: 'w1',
      completedAt: '',
      invitesSent: 0,
      invitesFailed: 0,
    })),
  }
}

describe('AnzsicSelector / IndustryStep', () => {
  it('searching "computer" surfaces code 7000 — Computer System Design', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    render(<IndustryStep token="tok" workspaceId="w1" api={api} onSave={vi.fn()} />)

    const searchInput = screen.getByRole('textbox', { name: /search industry/i })
    await user.type(searchInput, 'computer')

    expect(
      screen.getByText(/7000.*Computer System Design/i),
    ).toBeInTheDocument()
  })

  it('renders the exact legal disclaimer before selecting suggestions', () => {
    const api = fakeApi()
    render(<IndustryStep token="tok" workspaceId="w1" api={api} onSave={vi.fn()} />)

    const disclaimer = screen.getByRole('note')
    expect(disclaimer).toHaveTextContent(
      'General setup guidance only—not legal advice. Verify each obligation before activation.',
    )
  })

  it('selected obligations are labelled "Draft — verification required"', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    render(<IndustryStep token="tok" workspaceId="w1" api={api} onSave={vi.fn()} />)

    // Select Computer System Design (code 7000)
    const searchInput = screen.getByRole('textbox', { name: /search industry/i })
    await user.type(searchInput, 'computer')
    await user.click(screen.getByText(/7000.*Computer System Design/i))

    // Check the first suggestion checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    expect(screen.getByText(/Draft — verification required/)).toBeInTheDocument()
  })

  it('only checked obligations are submitted via saveIndustry', async () => {
    const user = userEvent.setup()
    const api = fakeApi()
    const onSave = vi.fn()

    render(<IndustryStep token="tok" workspaceId="w1" api={api} onSave={onSave} />)

    // Select Computer System Design (code 7000)
    const searchInput = screen.getByRole('textbox', { name: /search industry/i })
    await user.type(searchInput, 'computer')
    await user.click(screen.getByText(/7000.*Computer System Design/i))

    // Check only the first suggestion
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    // Save
    await user.click(screen.getByRole('button', { name: /save.*continue/i }))

    expect(api.saveIndustry).toHaveBeenCalledWith(
      expect.objectContaining({
        anzsicCode: '7000',
        obligations: expect.arrayContaining([
          expect.objectContaining({ name: expect.any(String), description: expect.any(String) }),
        ]),
      }),
    )
    // Only 1 obligation submitted (the checked one)
    const firstCall = api.saveIndustry.mock.lastCall as unknown as [{ anzsicCode: string; obligations: unknown[] }]
    expect(firstCall).not.toBeUndefined()
    expect(firstCall[0].obligations).toHaveLength(1)
  })
})
