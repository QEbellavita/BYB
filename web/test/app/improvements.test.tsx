import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImprovementsPage } from '../../src/app/ImprovementsPage'
import type { ImprovementsApi, Improvement } from '../../src/app/improvements-api'

function fakeImprovement(overrides?: Partial<Improvement>): Improvement {
  return {
    id: 'imp1',
    source: 'auto',
    title: 'Review KYC process',
    detail: 'KYC checks are slow',
    trigger_kind: 'compliance_gap',
    source_ref: null,
    suggested_change: 'Automate document verification',
    status: 'open',
    assignee_person_id: null,
    version: 1,
    ...overrides,
  }
}

function fakeApi(overrides?: Partial<ImprovementsApi>): ImprovementsApi {
  return {
    list: vi.fn(async () => [fakeImprovement()]),
    create: vi.fn(async () => fakeImprovement({ id: 'imp2', source: 'manual', title: 'New improvement' })),
    setStatus: vi.fn(async () => fakeImprovement({ status: 'dismissed' })),
    ...overrides,
  }
}

describe('ImprovementsPage', () => {
  it('renders a list of improvements with auto badge and status', async () => {
    const api = fakeApi()
    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)

    await waitFor(() => {
      expect(screen.getByText('Review KYC process')).toBeInTheDocument()
    })
    // auto badge
    expect(screen.getByText('Auto')).toBeInTheDocument()
    // status badge (appears in filter bar + row; use getAllByText)
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
    // trigger_kind
    expect(screen.getByText('compliance_gap')).toBeInTheDocument()
  })

  it('renders manual badge for manual improvements', async () => {
    const api = fakeApi({
      list: vi.fn(async () => [fakeImprovement({ source: 'manual', trigger_kind: null })]),
    })
    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)

    await waitFor(() => {
      expect(screen.getByText('Manual')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', async () => {
    let resolve!: (v: Improvement[]) => void
    const api = fakeApi({
      list: vi.fn(() => new Promise<Improvement[]>((res) => { resolve = res })),
    })
    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    await act(async () => { resolve([]) })
  })

  it('shows error state when list fails', async () => {
    const api = fakeApi({
      list: vi.fn(async () => { throw new Error('Network error') }),
    })
    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText(/could not load improvements/i)).toBeInTheDocument()
    })
  })

  it('filters improvements by status', async () => {
    const user = userEvent.setup()
    const dismissed = fakeImprovement({ id: 'imp2', title: 'Dismissed one', status: 'dismissed' })
    const api = fakeApi({ list: vi.fn(async () => [fakeImprovement(), dismissed]) })

    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('Review KYC process')).toBeInTheDocument()
    })

    // Both visible under 'All'
    expect(screen.getByText('Dismissed one')).toBeInTheDocument()

    // Filter to 'open' only
    await user.click(screen.getByRole('button', { name: /^open$/i }))
    expect(screen.getByText('Review KYC process')).toBeInTheDocument()
    expect(screen.queryByText('Dismissed one')).not.toBeInTheDocument()

    // Filter to 'dismissed' only
    await user.click(screen.getByRole('button', { name: /^dismissed$/i }))
    expect(screen.queryByText('Review KYC process')).not.toBeInTheDocument()
    expect(screen.getByText('Dismissed one')).toBeInTheDocument()
  })

  it('clicking Log improvement opens the create form', async () => {
    const user = userEvent.setup()
    const api = fakeApi({ list: vi.fn(async () => []) })

    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log improvement/i }))
    expect(screen.getByRole('heading', { name: /log improvement/i })).toBeInTheDocument()
  })

  it('submitting the create form calls create with title', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => fakeImprovement({ id: 'imp3', title: 'Improve onboarding' }))
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log improvement/i }))
    await user.type(screen.getByLabelText(/^title$/i), 'Improve onboarding')
    await user.type(screen.getByLabelText(/^detail$/i), 'Onboarding takes too long')

    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Improve onboarding', detail: 'Onboarding takes too long' }),
      )
    })
  })

  it('blocks submission when title is empty and shows validation message', async () => {
    const user = userEvent.setup()
    const create = vi.fn()
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log improvement/i }))
    // Don't fill in title
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeInTheDocument()
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('on a rejected create, the form values are retained', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => { throw new Error('Server error') })
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log improvement/i }))
    await user.type(screen.getByLabelText(/^title$/i), 'Retain this title')
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Retain this title')).toBeInTheDocument()
    })
  })

  it('dismiss status action button calls setStatus(id, dismissed)', async () => {
    const user = userEvent.setup()
    const setStatus = vi.fn(async () => fakeImprovement({ status: 'dismissed' }))
    const api = fakeApi({ setStatus })

    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('Review KYC process')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /mark improvement as dismissed/i }))

    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith('imp1', 'dismissed')
    })
  })

  it('actioned status action button calls setStatus(id, actioned)', async () => {
    const user = userEvent.setup()
    const setStatus = vi.fn(async () => fakeImprovement({ status: 'actioned' }))
    const api = fakeApi({ setStatus })

    render(<ImprovementsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('Review KYC process')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /mark improvement as actioned/i }))

    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith('imp1', 'actioned')
    })
  })
})
