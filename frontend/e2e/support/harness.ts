import {
  request as playwrightRequest,
  type APIRequest,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'

/**
 * The test server's harness (backend/e2e): it resets the database to the baseline, signs
 * browsers in without the sign-in form and reports the API's coverage. Only the e2e image
 * serves it, under /api/e2e.
 */

export type Role = 'admin' | 'viewer'

/** Someone in the baseline household. */
export interface BaselineUser {
  id: string
  email: string
  name: string
  role: Role
  /** Every baseline account signs in with the same password. */
  password: string
  is_active: boolean
  /** The authenticator-app key, for someone with two-step verification on. */
  totp_secret: string | null
  /** One-time recovery codes; each works once per reset. */
  recovery_codes: string[]
}

/** An invitation that hasn't been accepted yet. */
export interface BaselineInvitation {
  id: string
  email: string
  name: string
  role: Role
  token: string
  /** The one-time link an admin would share, which opens the invitation page. */
  link: string
}

/** What the database holds after a reset. It mirrors backend/e2e/baseline.py. */
export interface BaselineData {
  household_name: string
  users: {
    /** Alex Rivera, an admin who signs in with just a password. */
    admin: BaselineUser
    /** Jordan Rivera, an admin with an authenticator app and ten recovery codes. */
    two_step: BaselineUser
    /** Sam Rivera, a viewer, who sees everything and can change nothing. */
    viewer: BaselineUser
    /** Casey Rivera, a viewer whose account is turned off. */
    deactivated: BaselineUser
  }
  invitations: {
    /** Riley Chen, invited by Alex as a viewer two days ago. */
    pending: BaselineInvitation
  }
}

/** A baseline person by their role in the household, e.g. `'admin'` or `'viewer'`. */
export type BaselinePerson = keyof BaselineData['users']

/** Who to act as: a baseline person, or anyone else by email (e.g. someone a test invited). */
export type Who = BaselinePerson | { email: string }

/** The web app's view of a session, as /api/auth/session returns it. */
export interface SessionState {
  setup_required: boolean
  user: { id: string; email: string; name: string; role: Role } | null
  session: { csrf_token: string; remember: boolean } | null
}

interface CoverageFile {
  path: string
  content: string
}

/** The API's coverage report: HTML files and lcov.info, base64-encoded. */
export interface ApiCoverage {
  percent_covered: number
  files: CoverageFile[]
}

/** Reads a response's JSON, or fails with what the server said. */
export async function readJson<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what} failed with ${response.status()}: ${await response.text()}`)
  }
  return (await response.json()) as T
}

export function emailOf(baseline: BaselineData, who: Who): string {
  return typeof who === 'string' ? baseline.users[who].email : who.email
}

/**
 * Signs `api`'s cookie jar in as someone. For a browser context's `request`, that signs in its
 * pages too, since they share cookies.
 */
export async function startSession(
  api: APIRequestContext,
  email: string,
  { remember = false }: { remember?: boolean } = {},
): Promise<SessionState> {
  const response = await api.post('/api/e2e/sessions', { data: { email, remember } })
  return readJson<SessionState>(response, `Signing in as ${email}`)
}

export class Harness {
  private constructor(private readonly api: APIRequestContext) {}

  static async connect(
    baseURL: string,
    requests: APIRequest = playwrightRequest,
  ): Promise<Harness> {
    // The test server's certificate is self-signed.
    return new Harness(await requests.newContext({ baseURL, ignoreHTTPSErrors: true }))
  }

  /** Waits for the test server to answer, and checks it's the e2e image. */
  async waitUntilReady(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      let problem: string
      try {
        const health = await this.api.get('/api/health', { timeout: 5_000 })
        if (health.ok()) break
        problem = `its health check answered ${health.status()}`
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error)
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `The test server isn't ready (${problem}). Start it with \`make e2e-up\`, or point ` +
            'CASHCOVE_E2E_URL at one.',
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    const harness = await this.api.get('/api/e2e/baseline')
    if (harness.status() === 404) {
      throw new Error(
        "This server doesn't have the test harness, so it isn't the e2e image. The end-to-end " +
          'tests wipe the database, so they only run against `make e2e-up`.',
      )
    }
  }

  describe(): Promise<BaselineData> {
    return this.api.get('/api/e2e/baseline').then((r) => readJson(r, 'Reading the baseline'))
  }

  reset(): Promise<BaselineData> {
    return this.api.post('/api/e2e/reset').then((r) => readJson(r, 'Resetting to the baseline'))
  }

  async freshInstall(): Promise<string> {
    const response = await this.api.post('/api/e2e/fresh-install')
    return (await readJson<{ setup_code: string }>(response, 'Emptying the database')).setup_code
  }

  /** The API's coverage so far, or null when the API isn't measuring it. */
  async coverage(): Promise<ApiCoverage | null> {
    const response = await this.api.get('/api/e2e/coverage')
    if (response.status() === 404) return null
    return readJson<ApiCoverage>(response, "Reading the API's coverage")
  }

  dispose(): Promise<void> {
    return this.api.dispose()
  }
}
