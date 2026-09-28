import type { Connection, ConnectionSync, SharedAccount } from '@/api/connections'

export function makeShared(changes: Partial<SharedAccount> = {}): SharedAccount {
  return {
    id: 'plaid-card',
    name: 'Rewards Visa',
    official_name: 'Tartan Rewards Visa Signature',
    mask: '3333',
    type: 'credit_card',
    subtype: 'credit card',
    balance: '-612.40',
    currency: 'USD',
    state: 'imported',
    account_id: 'account-visa',
    ...changes,
  }
}

export const sharedCard = makeShared()
export const sharedChecking = makeShared({
  id: 'plaid-checking',
  name: 'Tartan Checking',
  official_name: null,
  mask: '0042',
  type: 'checking',
  subtype: 'checking',
  balance: '2310.55',
  state: 'skipped',
  account_id: null,
})
export const sharedSavings = makeShared({
  id: 'plaid-savings',
  name: 'Tartan Saving',
  official_name: null,
  mask: null,
  type: 'savings',
  subtype: 'savings',
  balance: '210.00',
  state: 'new',
  account_id: null,
})

export function makeSync(changes: Partial<ConnectionSync> = {}): ConnectionSync {
  return {
    id: 'sync-1',
    trigger: 'scheduled',
    started_at: '2026-09-27T09:00:00Z',
    finished_at: '2026-09-27T09:00:02Z',
    succeeded: true,
    added: 1,
    updated: 1,
    removed: 0,
    error_message: null,
    ...changes,
  }
}

export function makeConnection(changes: Partial<Connection> = {}): Connection {
  return {
    id: 'connection-tartan',
    provider: 'plaid',
    institution_name: 'Tartan Bank',
    institution_url: 'https://tartanbank.example.com',
    institution_color: '#b3282d',
    institution_logo: null,
    status: 'healthy',
    error_code: null,
    error_message: null,
    consent_expires_at: null,
    history: 'complete',
    syncing: false,
    last_synced_at: '2026-09-27T09:00:02Z',
    last_attempt_at: '2026-09-27T09:00:00Z',
    next_sync_at: '2026-09-27T15:00:00Z',
    created_at: '2026-06-09T12:00:00Z',
    accounts: [sharedCard, sharedChecking],
    last_sync: makeSync(),
    ...changes,
  }
}

export const tartan = makeConnection()
export const fidelity = makeConnection({
  id: 'connection-fidelity',
  institution_name: 'Fidelity',
  institution_url: null,
  institution_color: null,
  institution_logo: 'iVBORw0KGgo=',
  status: 'login_required',
  error_code: 'ITEM_LOGIN_REQUIRED',
  error_message: 'The bank needs you to sign in again before it shares anything new.',
  next_sync_at: null,
  accounts: [
    makeShared({
      id: 'plaid-retirement',
      name: 'Retirement',
      official_name: null,
      mask: '8812',
      type: 'investment',
      subtype: '401k',
      balance: '48210.55',
      account_id: 'account-retirement',
    }),
  ],
  last_sync: makeSync({
    id: 'sync-fidelity',
    succeeded: false,
    added: 0,
    updated: 0,
    error_message: 'The bank needs you to sign in again before it shares anything new.',
  }),
})
