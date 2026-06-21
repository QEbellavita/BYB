const API_URL = import.meta.env.VITE_API_URL as string

export async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}
