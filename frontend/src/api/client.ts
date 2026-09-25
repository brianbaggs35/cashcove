type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const CSRF_HEADER = 'X-CSRF-Token'

const OFFLINE = "Can't reach Cashcove. Check your connection and try again."
const SERVER_ERROR = 'Cashcove ran into a problem. Try again in a moment.'
const RATE_LIMITED = 'Too many requests. Wait a minute and try again.'
const INVALID = 'Check the highlighted fields and try again.'

/** A failed API call: a message people can act on, and the API's code for it. */
export class ApiError extends Error {
  /** The API's error code, e.g. `invalid_credentials`, or a generic one this client assigns. */
  readonly code: string
  /** Extra fields the API sent with the error, such as `retry_after`. */
  readonly data: Readonly<Record<string, unknown>>
  /** Messages for individual fields when a form didn't pass validation, keyed by field name. */
  readonly fields: Readonly<Record<string, string>>

  constructor(
    readonly status: number,
    message: string,
    options: {
      code?: string
      data?: Record<string, unknown>
      fields?: Record<string, string>
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = options.code ?? 'error'
    this.data = options.data ?? {}
    this.fields = options.fields ?? {}
  }

  /** Seconds to wait before trying again, when the API is rate limiting. */
  get retryAfter(): number | null {
    const seconds = this.data.retry_after
    return typeof seconds === 'number' ? seconds : null
  }
}

/** Hooks the rest of the app plugs in, so this module doesn't depend on stores or the UI. */
export interface ApiHooks {
  /** The session's CSRF token, sent with every change. */
  csrfToken: () => string | null
  /** The API says nobody is signed in any more, e.g. after the session timed out. */
  signedOut: () => void
  /** A sensitive change needs a fresh check; resolves true once the person confirmed it's them. */
  verify: () => Promise<boolean>
  /** A request succeeded, which also keeps the session alive on the server. */
  activity: () => void
}

const defaultHooks: ApiHooks = {
  csrfToken: () => null,
  signedOut: () => undefined,
  verify: () => Promise.resolve(false),
  activity: () => undefined,
}

let hooks: ApiHooks = { ...defaultHooks }

export function configureApi(next: Partial<ApiHooks>): void {
  hooks = { ...hooks, ...next }
}

export function resetApiHooks(): void {
  hooks = { ...defaultHooks }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ValidationIssue {
  loc: unknown[]
  msg: string
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  return isRecord(value) && Array.isArray(value.loc) && typeof value.msg === 'string'
}

/** FastAPI's validation messages are written for developers; these read better in a form. */
function fieldMessage(field: string, message: string): string {
  if (field === 'email') return 'Enter a valid email address.'
  if (message.startsWith('String should have at most')) return 'This is too long.'
  if (message.startsWith('String should have at least')) return 'This is required.'
  return message.endsWith('.') ? message : `${message}.`
}

function toError(status: number, body: unknown): ApiError {
  const detail = isRecord(body) ? body.detail : undefined
  if (isRecord(detail) && typeof detail.code === 'string' && typeof detail.message === 'string') {
    const { code, message, ...data } = detail
    return new ApiError(status, message, { code, data })
  }
  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {}
    for (const issue of detail.filter(isValidationIssue)) {
      const field = String(issue.loc.at(-1))
      fields[field] ??= fieldMessage(field, issue.msg)
    }
    const [only, ...others] = Object.values(fields)
    return new ApiError(status, only !== undefined && others.length === 0 ? only : INVALID, {
      code: 'invalid',
      fields,
    })
  }
  if (status === 429) return new ApiError(status, RATE_LIMITED, { code: 'rate_limited' })
  if (status >= 500) return new ApiError(status, SERVER_ERROR, { code: 'server_error' })
  const message = typeof detail === 'string' ? detail : `The request failed (error ${status}).`
  return new ApiError(status, message.endsWith('.') ? message : `${message}.`)
}

export async function apiRequest<T>(
  method: Method,
  path: string,
  body?: unknown,
  { retry = true }: { retry?: boolean } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  const init: RequestInit = { method, headers, credentials: 'same-origin' }
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json')
    init.body = JSON.stringify(body)
  }
  const token = hooks.csrfToken()
  if (method !== 'GET' && token) headers.set(CSRF_HEADER, token)

  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError(0, OFFLINE, { code: 'offline' })
  }
  if (response.ok) {
    hooks.activity()
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  const error = toError(response.status, await response.json().catch(() => undefined))
  if (error.code === 'verification_required' && retry && (await hooks.verify())) {
    return apiRequest<T>(method, path, body, { retry: false })
  }
  if (error.code === 'not_signed_in') hooks.signedOut()
  throw error
}

export const apiGet = <T>(path: string) => apiRequest<T>('GET', path)
export const apiPost = <T = void>(path: string, body?: unknown) => apiRequest<T>('POST', path, body)
export const apiPut = <T>(path: string, body: unknown) => apiRequest<T>('PUT', path, body)
export const apiPatch = <T>(path: string, body: unknown) => apiRequest<T>('PATCH', path, body)
export const apiDelete = (path: string) => apiRequest<undefined>('DELETE', path)

/** Words to show for any error, including ones that didn't come from the API. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** A sensitive change the person chose not to confirm; there's nothing to report. */
export function isCancelled(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'verification_required'
}
