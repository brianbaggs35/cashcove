import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  request as playwrightRequest,
  type APIRequest,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test'

import type { AiRequest } from './ai'
import type { BankTransaction } from './plaid'

/**
 * The test server's harness (backend/e2e): it resets the database to the baseline, signs
 * browsers in without the sign-in form and reports the API's coverage. Only the e2e image
 * serves it, under /api/e2e.
 */

export type Role = 'admin' | 'viewer'

/** The admin's and the viewer's saved sign-ins, which `signInFiles` holds. */
export type SavedSignIn = 'admin' | 'viewer'

/** A browser someone is signed in on, as Settings > Security lists it. */
export interface BaselineDevice {
  id: string
  /** What Settings calls it, e.g. `'Safari on iPhone'`. */
  device: string
  ip_address: string
  signed_in_hours_ago: number
  last_seen_hours_ago: number
  /** Which saved sign-in it is, for the one behind `signInFiles.admin` or `.viewer`. */
  saved_sign_in: SavedSignIn | null
}

/** A passkey, with what `addPasskey()` needs to give it to Chromium's virtual authenticator. */
export interface BaselinePasskey {
  id: string
  name: string
  /** The password manager holding it, e.g. `'iCloud Keychain'`. */
  provider: string | null
  added_days_ago: number
  last_used_hours_ago: number | null
  /** The domain it belongs to: the test server's name. */
  rp_id: string
  /** Base64url, as the API and browsers write it. */
  credential_id: string
  /** The account handle it's saved under, base64url. */
  user_handle: string
  /** Its made-up private key: PKCS #8, base64url. */
  private_key: string
}

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
  /** How many hours before the reset they last signed in. */
  last_sign_in_hours_ago: number | null
  /** The browsers they're signed in on, most recently used first. */
  devices: BaselineDevice[]
  passkeys: BaselinePasskey[]
}

/** A sign-in or security change in the activity logs in Settings. */
export interface BaselineActivity {
  id: string
  /** What happened, e.g. `'signed_in'`, `'user_invited'` or `'passkey_added'`. */
  event: string
  /** Whose account it was about, by key in `baseline.users`: null for an invitation, or for
   * a failed sign-in with an email nobody uses. */
  user: BaselinePerson | null
  /** Who did it, when an admin acted on someone else's account. */
  actor: BaselinePerson | null
  hours_ago: number
  /** The browser it came from, e.g. `'Firefox on macOS'`. */
  device: string
  ip_address: string
  /** More about it, e.g. `{ method: 'passkey' }` or `{ email, role }`. */
  details: Record<string, unknown>
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

/** A bank connected through Plaid, as the Connect tab shows it. */
export interface BaselineConnection {
  id: string
  /** The bank's name, e.g. `'Tartan Bank'`. */
  institution: string
  /** `'login_required'` when the bank wants someone to sign in again. */
  status: 'healthy' | 'login_required' | 'error'
  /** Plaid's error code, while the bank needs attention, e.g. `'ITEM_LOGIN_REQUIRED'`. */
  error_code: string | null
  /** The accounts it keeps up to date, by key in `baseline.accounts`. */
  accounts: BaselineAccountKey[]
  /** What the bank calls the accounts it shares that the household chose not to import. */
  skipped: string[]
  /** How many hours before the reset it last synced. */
  last_synced_hours_ago: number | null
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
  /** Entered by hand, from the bank through Plaid, or imported from the bank's CSV export. */
  source: 'manual' | 'plaid' | 'file'
  /** What the bank called it, for linked accounts' and imported transactions. */
  original_description: string | null
  /** The import that brought it in, by key in `baseline.imports`. */
  file_import: BaselineImportKey | null
}

/** A CSV layout saved for a bank's files, as the Import tab lists it. */
export interface BaselineSavedFormat {
  id: string
  name: string
  /** The column names of the files it reads, which is how it recognizes them. */
  headers: string[]
  /** The account it was last used for, by key in `baseline.accounts`. */
  account: BaselineAccountKey | null
  /** How many hours before the reset it was last used, or null when it never was. */
  last_used_hours_ago: number | null
}

/** A statement file imported into an account kept by hand. */
export interface BaselineImport {
  id: string
  /** Its account's key in `baseline.accounts`. */
  account: BaselineAccountKey
  account_id: string
  file_name: string
  /** QFX and QBO files are OFX inside, so they're `'ofx'` too. */
  format: 'csv' | 'ofx' | 'qif'
  /** The saved format that read it, by key in `baseline.saved_formats`. */
  saved_format: BaselineSavedFormatKey | null
  /** How many transactions it added, and how many of the file's rows it left out. */
  added: number
  skipped: number
  /** What its transactions add up to, e.g. `'31390.29'`. */
  total: string
  /** How many days before the reset its first and last transactions were. */
  first_days_ago: number
  last_days_ago: number
  /** How many hours before the reset it was imported. */
  hours_ago: number
  /** Who imported it. */
  created_by: BaselinePerson
}

/** What counts toward a baseline budget: a category by name, or an account or a transaction on its own by key. */
export interface BaselineBudgetSource {
  kind: 'income' | 'spending'
  type: 'category' | 'account' | 'transaction'
  target: string
  target_id: string
}

/** A budget the household set up with Cashcove. */
export interface BaselineBudget {
  id: string
  name: string
  period: 'weekly' | 'biweekly' | 'monthly' | 'yearly'
  /** What it has for each period, e.g. `'3600.00'`. */
  amount: string
  sources: BaselineBudgetSource[]
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
  /** Every sign-in and security change on record, newest first. */
  activity: BaselineActivity[]
  accounts: {
    /** Everyday checking at Harbor Credit Union, kept by hand. */
    checking: BaselineAccount
    /** Rainy day fund, a savings account at Harbor Credit Union, kept by hand. */
    savings: BaselineAccount
    /** Rewards Visa at Tartan Bank, linked through Plaid, with 612.40 owed. */
    card: BaselineAccount
    /** Car loan at Harbor Credit Union, kept by hand, with 9,120.00 owed and no transactions. */
    loan: BaselineAccount
    /** Retirement 401(k) at Fidelity, linked through Plaid, with no transactions. */
    retirement: BaselineAccount
    /** Old store card, a closed card kept by hand. */
    closed: BaselineAccount
  }
  /** The banks connected through Plaid. Both came through the test server's stand-in for
   * Plaid, so they sync, reconnect and report new transactions (`plaid.addTransaction`)
   * without reaching Plaid. */
  connections: {
    /** Tartan Bank: imports the Rewards Visa and skips Tartan Checking; synced 3 hours ago. */
    tartan: BaselineConnection
    /** Fidelity: imports the Retirement 401(k), and wants Alex to sign in again. */
    fidelity: BaselineConnection
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
  /**
   * The rest of the year's transactions, newest first: bills, paychecks and shopping, 15 to
   * 398 days old. Their payees repeat, but never one of the named transactions' payees.
   */
  history: BaselineTransaction[]
  /** The statement files imported when the household started with Cashcove, newest first. */
  imports: {
    /** harbor-savings-history.qfx: the Rainy day fund's history from before then. */
    savings_history: BaselineImport
    /** harbor-checking-history.csv: Everyday checking's, read with the Harbor Credit Union
     * checking format; 2 of its rows were left out. */
    checking_history: BaselineImport
  }
  /** The CSV layouts saved for banks' files. */
  saved_formats: {
    /** Harbor Credit Union checking: date, description, amount, balance and ID columns. */
    harbor_checking: BaselineSavedFormat
    /** Maple store card: charges as positive amounts, with the bank's categories; never used. */
    maple_card: BaselineSavedFormat
  }
  /** The household's budgets, the smallest period first. */
  budgets: {
    /** 150.00 a week for restaurants, coffee, shopping and entertainment. */
    spending_money: BaselineBudget
    /** 3,600.00 a month: paychecks and interest in, bills, groceries and the card out. */
    household: BaselineBudget
    /** 52,000.00 a year: paychecks and interest in, everything out of checking. */
    year: BaselineBudget
  }
}

export type BaselineAccountKey = keyof BaselineData['accounts']
export type BaselineImportKey = keyof BaselineData['imports']
export type BaselineSavedFormatKey = keyof BaselineData['saved_formats']
export type BaselineConnectionKey = keyof BaselineData['connections']
export type BaselineTransactionKey = keyof BaselineData['transactions']
export type BaselineBudgetKey = keyof BaselineData['budgets']

/** A baseline transaction's date (YYYY-MM-DD), as the last reset gave it. */
export function dateOf(transaction: Pick<BaselineTransaction, 'days_ago'>): string {
  const day = new Date()
  day.setUTCDate(day.getUTCDate() - transaction.days_ago)
  return day.toISOString().slice(0, 10)
}

/** Every baseline transaction, the named ones and the history, newest first. */
export function allTransactions(baseline: BaselineData): BaselineTransaction[] {
  return [...Object.values(baseline.transactions), ...baseline.history].sort(
    (a, b) => a.days_ago - b.days_ago,
  )
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

function newContext(requests: APIRequest, baseURL: string): Promise<APIRequestContext> {
  // The test server's certificate is self-signed.
  return requests.newContext({ baseURL, ignoreHTTPSErrors: true })
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
  private constructor(
    private readonly api: APIRequestContext,
    private readonly baseURL: string,
    private readonly requests: APIRequest,
  ) {}

  static async connect(
    baseURL: string,
    requests: APIRequest = playwrightRequest,
  ): Promise<Harness> {
    return new Harness(await newContext(requests, baseURL), baseURL, requests)
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

  /**
   * Saves the admin's or the viewer's saved sign-in to a file for
   * `test.use({ storageState })`. The session is part of the baseline, so every reset brings
   * it back and the file keeps working.
   */
  async saveSignIn(who: SavedSignIn, file: string): Promise<void> {
    // A cookie jar of its own, holding just this sign-in.
    const request = await newContext(this.requests, this.baseURL)
    try {
      const response = await request.post(`/api/e2e/saved-sign-ins/${who}`)
      await readJson<SessionState>(response, `Signing in as the baseline's ${who}`)
      await mkdir(path.dirname(file), { recursive: true })
      await request.storageState({ path: file })
    } finally {
      await request.dispose()
    }
  }

  /** Has an account's bank report a new transaction, which the bank's next sync brings in. */
  async addBankTransaction(transaction: BankTransaction): Promise<void> {
    const response = await this.api.post('/api/e2e/plaid/transactions', { data: transaction })
    await readJson(response, `Adding ${transaction.payee} at the bank`)
  }

  /** Has a connected bank fail its syncs with one of Plaid's error codes, or stop with null. */
  async failBankSyncs(connectionId: string, code: string | null): Promise<void> {
    const response = await this.api.post(`/api/e2e/plaid/connections/${connectionId}/error`, {
      data: { code },
    })
    if (!response.ok()) {
      throw new Error(
        `Making the bank fail failed with ${response.status()}: ${await response.text()}`,
      )
    }
  }

  /**
   * Every request an AI provider has received since the last reset, as it was sent: what
   * Cashcove asked, and with which key, for checking what was and wasn't shared.
   */
  async aiRequests(): Promise<AiRequest[]> {
    const response = await this.api.get('/api/e2e/ai/requests')
    return readJson<AiRequest[]>(response, 'Reading what the AI providers were sent')
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
