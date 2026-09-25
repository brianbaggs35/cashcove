export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export async function apiRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  const init: RequestInit = { method, headers, credentials: 'same-origin' }
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(body)
  }
  const response = await fetch(`/api${path}`, init)
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => undefined)
    throw new ApiError(response.status, `${method} ${path} failed with ${response.status}`, detail)
  }
  return (await response.json()) as T
}

export const apiGet = <T>(path: string) => apiRequest<T>('GET', path)
export const apiPut = <T>(path: string, body: unknown) => apiRequest<T>('PUT', path, body)
