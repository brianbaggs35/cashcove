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

export type AccountType =
  'checking' | 'savings' | 'cash' | 'credit_card' | 'investment' | 'loan' | 'mortgage' | 'other'

/** An account in the baseline household. */
export interface BaselineAccount {
  id: string
  name: string
  type: AccountType
  /** `'plaid'` when its bank keeps it up to date, `'manual'` when the household does. */
  source: 'manual' | 'plaid'
  institution: string
  mask: string
  currency: string
  /** Amounts are strings, as the API sends them: `'-612.40'` is 612.40 owed. */
  balance: string
  available_balance: string | null
  credit_limit: string | null
  notes: string | null
  closed: boolean
}

/** The suggested category groups, which a new household starts with. */
export type BaselineCategoryGroupName =
  | 'Income'
  | 'Housing'
  | 'Bills & utilities'
  | 'Food & drink'
  | 'Transportation'
  | 'Shopping'
  | 'Health & wellness'
  | 'Lifestyle'
  | 'Family & education'
  | 'Financial'
  | 'Transfers'

/** The suggested categories, which a new household starts with. */
export type BaselineCategoryName =
  | 'Paycheck'
  | 'Interest & dividends'
  | 'Other income'
  | 'Rent & mortgage'
  | 'Home maintenance'
  | 'Home goods'
  | 'Utilities'
  | 'Phone & internet'
  | 'Insurance'
  | 'Subscriptions'
  | 'Groceries'
  | 'Restaurants'
  | 'Coffee'
  | 'Gas & fuel'
  | 'Car maintenance'
  | 'Parking & tolls'
  | 'Public transit'
  | 'Rideshare & taxis'
  | 'Shopping'
  | 'Clothing'
  | 'Electronics'
  | 'Medical'
  | 'Pharmacy'
  | 'Fitness'
  | 'Entertainment'
  | 'Travel'
  | 'Pets'
  | 'Personal care'
  | 'Gifts & donations'
  | 'Kids'
  | 'Education'
  | 'Bank fees'
  | 'Taxes'
  | 'Loan payments'
  | 'Cash & ATM'
  | 'Transfers'
  | 'Credit card payments'

export interface BaselineCategoryGroup {
  id: string
  name: BaselineCategoryGroupName
  /** Whether its transactions count as spending, as income, or as neither. */
  kind: 'expense' | 'income' | 'transfer'
}

export interface BaselineCategory {
  id: string
  name: BaselineCategoryName
  emoji: string
  group: BaselineCategoryGroupName
  group_id: string
}

/** A transaction in the baseline. `dateOf(transaction)` gives its date. */
export interface BaselineTransaction {
  id: string
  /** Its account's key in `baseline.accounts`. */
  account: BaselineAccountKey
  account_id: string
  /** How many days before the reset it happened, in UTC. */
  days_ago: number
  /** Positive when money came in, negative when it went out. */
  amount: string
  payee: string
  category: BaselineCategoryName | null
  category_id: string | null
  notes: string | null
  /** Authorized but not yet posted by the bank. */
  pending: boolean
  source: 'manual' | 'plaid' | 'file'
  /** What the bank called it, for a linked account's transactions. */
  original_description: string | null
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
  accounts: {
    /** Everyday checking at Harbor Credit Union, kept by hand. */
    checking: BaselineAccount
    /** Rainy day fund, a savings account at Harbor Credit Union, kept by hand. */
    savings: BaselineAccount
    /** Rewards Visa at Tartan Bank, linked through Plaid, with 612.40 owed. */
    card: BaselineAccount
    /** Old store card, a closed card kept by hand. */
    closed: BaselineAccount
  }
  /** Every suggested category group, by name. */
  category_groups: Record<BaselineCategoryGroupName, BaselineCategoryGroup>
  /** Every suggested category, by name. */
  categories: Record<BaselineCategoryName, BaselineCategory>
  transactions: {
    /** Blue Bottle Coffee, 4.50 on the card today, still pending. */
    coffee: BaselineTransaction
    /** Venmo, 40.00 from checking yesterday, with no category. */
    venmo: BaselineTransaction
    /** Whole Foods, 84.12 from checking, with a note. */
    groceries: BaselineTransaction
    /** Target, a refund of 18.20 on the card. */
    refund: BaselineTransaction
    /** Harbor Credit Union, 10.42 of interest into savings. */
    interest: BaselineTransaction
    /** Netflix, 15.49 on the card. */
    netflix: BaselineTransaction
    /** Tartan Bank, 300.00 from checking to pay the card, a transfer. */
    card_payment: BaselineTransaction
    /** City Power & Light, 96.40 from checking. */
    power: BaselineTransaction
    /** Parkside Apartments, 1,850.00 of rent from checking. */
    rent: BaselineTransaction
    /** Acme Corp, a 2,400.00 paycheck into checking. */
    paycheck: BaselineTransaction
    /** Maple Department Store, 35.00 on the closed card 45 days ago. */
    store: BaselineTransaction
  }
}

export type BaselineAccountKey = keyof BaselineData['accounts']
export type BaselineTransactionKey = keyof BaselineData['transactions']

/** A baseline transaction's date (YYYY-MM-DD), as the last reset gave it. */
export function dateOf(transaction: Pick<BaselineTransaction, 'days_ago'>): string {
  const day = new Date()
  day.setUTCDate(day.getUTCDate() - transaction.days_ago)
  return day.toISOString().slice(0, 10)
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
