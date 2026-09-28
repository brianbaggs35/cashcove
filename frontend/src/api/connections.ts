import type { AccountType } from '@/api/accounts'
import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'
import type { HISTORY_DAYS } from '@/api/preferences'

/** `login_required` needs someone to sign in to the bank again; `error` retries on its own. */
export type ConnectionStatus = 'healthy' | 'login_required' | 'error'

/** How much of a new connection's history has arrived: none, the last month or so, or all. */
export type HistoryStatus = 'pending' | 'recent' | 'complete'

export type SyncTrigger = 'linked' | 'scheduled' | 'manual' | 'reconnected'

/** Whether an account the bank shares is imported, was left out, or is new since last chosen. */
export type SharedAccountState = 'imported' | 'skipped' | 'new'

export type HistoryDays = (typeof HISTORY_DAYS)[number]

/** An account the bank shares through Plaid. */
export interface SharedAccount {
  /** Plaid's ID for it. */
  id: string
  name: string
  official_name: string | null
  mask: string | null
  type: AccountType
  subtype: string | null
  /** As Cashcove shows balances: negative for what's owed. */
  balance: string
  currency: string
  state: SharedAccountState
  /** The Cashcove account it's imported as. */
  account_id: string | null
}

export interface ConnectionSync {
  id: string
  trigger: SyncTrigger
  started_at: string
  finished_at: string
  succeeded: boolean
  added: number
  updated: number
  removed: number
  error_message: string | null
}

export interface Connection {
  id: string
  provider: 'plaid'
  institution_name: string
  institution_url: string | null
  /** The bank's brand color, e.g. `#0a4d8c`. */
  institution_color: string | null
  /** The bank's logo, a base64 PNG. */
  institution_logo: string | null
  status: ConnectionStatus
  /** Plaid's error code, for support. */
  error_code: string | null
  error_message: string | null
  /** Some banks only share for so long before someone has to agree again. */
  consent_expires_at: string | null
  history: HistoryStatus
  syncing: boolean
  last_synced_at: string | null
  last_attempt_at: string | null
  /** When the schedule syncs it next, or null when it won't. */
  next_sync_at: string | null
  created_at: string
  accounts: SharedAccount[]
  last_sync: ConnectionSync | null
}

export interface LinkToken {
  link_token: string
  expiration: string
}

export interface AccountChoice {
  /** Plaid's ID for the account. */
  id: string
  /** What to call it once imported; the bank's name when left out. */
  name?: string
}

export interface AccountsChoice {
  accounts: AccountChoice[]
  /** What happens to imported accounts left out: kept with their history, or deleted. */
  removed?: 'keep' | 'delete'
}

/** `reconnect` signs in to the bank again; `accounts` changes which accounts it shares. */
export type LinkMode = 'reconnect' | 'accounts'

export const fetchConnections = () => apiGet<Connection[]>('/connections')
export const fetchConnection = (id: string) => apiGet<Connection>(`/connections/${id}`)
export const createLinkToken = (historyDays?: HistoryDays) =>
  apiPost<LinkToken>('/connections/link-token', { history_days: historyDays ?? null })
export const createConnection = (publicToken: string) =>
  apiPost<Connection>('/connections', { public_token: publicToken })
export const chooseAccounts = (id: string, choice: AccountsChoice) =>
  apiPut<Connection>(`/connections/${id}/accounts`, choice)
export const updateLinkToken = (id: string, mode: LinkMode) =>
  apiPost<LinkToken>(`/connections/${id}/link-token`, { mode })
export const syncConnection = (id: string, reason: 'manual' | 'reconnected' = 'manual') =>
  apiPost<Connection>(`/connections/${id}/sync`, { reason })
export const fetchSyncs = (id: string) => apiGet<ConnectionSync[]>(`/connections/${id}/syncs`)
export const deleteConnection = (id: string, keepAccounts: boolean) =>
  apiDelete(`/connections/${id}?keep_accounts=${keepAccounts}`)
