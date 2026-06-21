export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(
  path: string,
  token: string,
  options: { method?: string; workspaceId?: string; body?: unknown } = {},
): Promise<T> {
  const { method, workspaceId, body } = options

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (workspaceId !== undefined) {
    headers['x-workspace-id'] = workspaceId
  }

  const apiUrl = import.meta.env.VITE_API_URL as string
  const res = await fetch(`${apiUrl}${path}`, {
    method: method ?? 'GET',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    let errorBody: unknown
    try {
      errorBody = await res.json()
    } catch {
      errorBody = null
    }
    throw new ApiError(res.status, errorBody)
  }

  return res.json() as Promise<T>
}
