import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComplaintsPage } from '../../src/app/ComplaintsPage'
import type { ComplaintsApi, Complaint } from '../../src/app/complaints-api'

function fakeComplaint(overrides?: Partial<Complaint>): Complaint {
  return {
    id: 'c1',
    reference: 'CPL-001',
    complainant_name: 'Alice Smith',
    complainant_contact: 'alice@example.com',
    channel: 'email',
    received_at: '2026-06-01T10:00:00Z',
    description: 'Product did not arrive',
    category: 'product',
    severity: 'medium',
    assignee_person_id: null,
    status: 'new',
    resolution_notes: null,
    resolved_at: null,
    version: 1,
    ...overrides,
  }
}

function fakeApi(overrides?: Partial<ComplaintsApi>): ComplaintsApi {
  return {
    list: vi.fn(async () => [fakeComplaint()]),
    create: vi.fn(async () => fakeComplaint({ id: 'c2', reference: 'CPL-002', description: 'New complaint' })),
    update: vi.fn(async () => fakeComplaint()),
    resolve: vi.fn(async () => fakeComplaint({ status: 'resolved' })),
    ...overrides,
  }
}

describe('ComplaintsPage', () => {
  it('renders a list of complaints', async () => {
    const api = fakeApi()
    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)

    await waitFor(() => {
      expect(screen.getByText('Product did not arrive')).toBeInTheDocument()
    })
    expect(screen.getByText('CPL-001')).toBeInTheDocument()
  })

  it('shows loading state initially', async () => {
    let resolve!: (v: Complaint[]) => void
    const api = fakeApi({
      list: vi.fn(() => new Promise<Complaint[]>((res) => { resolve = res })),
    })
    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    await act(async () => { resolve([]) })
  })

  it('shows error state when list fails', async () => {
    const api = fakeApi({
      list: vi.fn(async () => { throw new Error('Network error') }),
    })
    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText(/could not load complaints/i)).toBeInTheDocument()
    })
  })

  it('filters complaints by status', async () => {
    const user = userEvent.setup()
    const resolved = fakeComplaint({ id: 'c2', reference: 'CPL-002', description: 'Resolved one', status: 'resolved' })
    const api = fakeApi({ list: vi.fn(async () => [fakeComplaint(), resolved]) })

    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('Product did not arrive')).toBeInTheDocument()
    })

    // Both visible initially (All filter)
    expect(screen.getByText('Resolved one')).toBeInTheDocument()

    // Filter to 'new' only
    await user.click(screen.getByRole('button', { name: /^new$/i }))
    expect(screen.getByText('Product did not arrive')).toBeInTheDocument()
    expect(screen.queryByText('Resolved one')).not.toBeInTheDocument()

    // Filter to 'resolved' only
    await user.click(screen.getByRole('button', { name: /^resolved$/i }))
    expect(screen.queryByText('Product did not arrive')).not.toBeInTheDocument()
    expect(screen.getByText('Resolved one')).toBeInTheDocument()
  })

  it('clicking Log complaint opens the intake form', async () => {
    const user = userEvent.setup()
    const api = fakeApi({ list: vi.fn(async () => []) })

    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log complaint/i }))
    expect(screen.getByRole('heading', { name: /log complaint/i })).toBeInTheDocument()
  })

  it('submitting the intake form calls create with description and category', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => fakeComplaint({ id: 'c3', reference: 'CPL-003', description: 'Billing issue' }))
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log complaint/i }))

    await user.type(screen.getByLabelText(/description/i), 'Billing issue')
    await user.selectOptions(screen.getByLabelText(/category/i), 'billing')
    await user.selectOptions(screen.getByLabelText(/channel/i), 'phone')

    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Billing issue', category: 'billing', channel: 'phone' }),
      )
    })
  })

  it('blocks submission when description is empty and shows validation message', async () => {
    const user = userEvent.setup()
    const create = vi.fn()
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log complaint/i }))
    // Don't fill in description
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByText(/description is required/i)).toBeInTheDocument()
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('on a rejected create, the form values are retained', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async () => { throw new Error('Server error') })
    const api = fakeApi({ list: vi.fn(async () => []), create })

    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('0 total')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /log complaint/i }))
    await user.type(screen.getByLabelText(/description/i), 'Retain this text')
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Retain this text')).toBeInTheDocument()
    })
  })

  it('resolve button calls resolve(id) and updates the list', async () => {
    const user = userEvent.setup()
    const resolve = vi.fn(async () => fakeComplaint({ status: 'resolved' }))
    const api = fakeApi({ resolve })

    render(<ComplaintsPage token="tok" workspaceId="ws1" api={api} />)
    await waitFor(() => {
      expect(screen.getByText('Product did not arrive')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /resolve complaint/i }))

    await waitFor(() => {
      expect(resolve).toHaveBeenCalledWith('c1')
    })
  })
})
