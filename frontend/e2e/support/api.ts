import type { APIRequestContext } from '@playwright/test'

import { readJson } from './harness'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Calls the API as a signed-in person, the way the web app does (with the session's CSRF
 * token), so a test can set up what it needs without clicking through the UI first. Paths
 * leave out /api, like the web app's own client: `api.get('/settings')`.
 */
export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly csrfToken: string,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path)
  }

  post<T = undefined>(path: string, body?: unknown): Promise<T> {
    return this.send<T>('POST', path, body)
  }

  put<T = undefined>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PUT', path, body)
  }

  patch<T = undefined>(path: string, body: unknown): Promise<T> {
    return this.send<T>('PATCH', path, body)
  }

  delete(path: string): Promise<undefined> {
    return this.send<undefined>('DELETE', path)
  }

  private async send<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const response = await this.request.fetch(`/api${path}`, {
      method,
      data: body,
      headers: method === 'GET' ? {} : { 'X-CSRF-Token': this.csrfToken },
    })
    if (response.status() === 204) return undefined as T
    return readJson<T>(response, `${method} /api${path}`)
  }
}
