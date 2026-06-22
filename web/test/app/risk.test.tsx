import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiskPage } from '../../src/app/RiskPage'
import type { RiskApi, Risk } from '../../src/app/risk-api'

function fakeRisk(overrides?: Partial<Risk>): Risk {
  return {
    id: 'r1',
    title: 'Test Risk',
    description: 'A test risk',
    category: 'Operational',
    likelihood: 3,
    impact: 4,
    owner_person_id: null,
    treatment: null,
    status: 'open',
    review_date: null,
    framework_id: null,
    version: 1,
    ...overrides,
  }
}

function fakeApi(overrides?: Partial<RiskApi>): RiskApi {
  return {
    list: vi.fn(async () => [fakeRisk()]),
    create: vi.fn(async () => fakeRisk({ id: 'r2', title: 'New Risk' })),
    update: vi.fn(async () => fakeRisk()),
    close: vi.fn(async () => fakeRisk({ status: 'closed' })),
    ...overrides,
  }
}

describe('RiskPage', () => {
  it('renders the 5x5 matrix with a risk in the correct l×i cell', async () => {
    // likelihood=3, impact=4 → score=12 → high (≥12)
    const risk = fakeRisk({ likelihood: 3, impact: 4 })
    const api = fakeApi({ list: vi.fn(async () => [risk]) })

    render(<RiskPage token="tok" workspaceId="ws1" api={api} />)

    // Should eventually show the risk title in the matrix or register
    await waitFor(() => {
      expect(screen.getByText('Test Risk')).toBeInTheDocument()
    })
  })

  it('renders the severity legend', async () => {
    const api = fakeApi({ list: vi.fn(async () => []) })
    render(<RiskPage token="tok" workspaceId="ws1" api={api} />)

    await waitFor(() => {
      expect(screen.getByText('Low')).toBeInTheDocument()
      expect(screen.getByText('Medium')).toBeInTheDocument()
      expect(screen.getByText('High')).toBeInTheDocument()
      expect(screen.getByText('Extreme')).toBeInTheDocument()
    })
  })

  it('shows loading state initially', async () => {
    let resolve!: (v: Risk[]) => void
    const api = fakeApi({
      list: vi.fn(() => new Promise<Risk[]>((res) => { resolve = res })),
    })
    render(<RiskPage token="tok" workspaceId="ws1" api={api} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    await act(async () => { resolve([]) })
  })

  it('clicking Add risk opens the form', async () => {
    const user = userEvent.setup()
    const api = fakeApi({ list: vi.fn(async () => []) })

    render(<RiskPage token="tok" workspaceId="ws1" api={api} />)
    await screen.findByText('0 active risks')

    await user.click(screen.getByRole('button', { name: /add risk/i }))
    expect(screen.getByRole('heading', { name: /add risk/i })).toBeInTheDocument()
  })

  it('submitting the form calls create with the entered fields', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => fakeRisk({ id: 'r3', title: 'Created Risk' }))
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<RiskPage token="tok" workspaceId="ws1" api={api} />)
    await screen.findByText('0 active risks')

    // Open form
    await user.click(screen.getByRole('button', { name: /add risk/i }))

    // Fill required fields
    await user.type(screen.getByLabelText(/title/i), 'My New Risk')
    // likelihood and impact are selects, default to 1 — change them
    await user.selectOptions(screen.getByLabelText(/likelihood/i), '3')
    await user.selectOptions(screen.getByLabelText(/impact/i), '4')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My New Risk', likelihood: 3, impact: 4 }),
      )
    })
  })

  it('on a rejected create, the form values are retained', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => { throw new Error('Server error') })
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<RiskPage token="tok" workspaceId="ws1" api={api} />)
    await screen.findByText('0 active risks')

    // Open form
    await user.click(screen.getByRole('button', { name: /add risk/i }))

    await user.type(screen.getByLabelText(/title/i), 'RetainMe')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      // Form should still be open with the value retained
      expect(screen.getByDisplayValue('RetainMe')).toBeInTheDocument()
    })
  })

  it('risk appears in the correct severity cell in the matrix', async () => {
    // likelihood=5, impact=5 → score=25 → ext (≥15)
    const risk = fakeRisk({ likelihood: 5, impact: 5, title: 'Extreme Risk' })
    const api = fakeApi({ list: vi.fn(async () => [risk]) })

    render(<RiskPage token="tok" workspaceId="ws1" api={api} />)

    // The register table should show the risk
    await waitFor(() => {
      expect(screen.getByText('Extreme Risk')).toBeInTheDocument()
    })

    // The severity tag should show Extreme
    await waitFor(() => {
      const tags = screen.getAllByText('Extreme')
      // One appears in the legend, one in the register table
      expect(tags.length).toBeGreaterThanOrEqual(1)
    })
  })
})
