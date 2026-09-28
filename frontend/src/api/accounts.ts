import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'

export type AccountType =
  'checking' | 'savings' | 'cash' | 'credit_card' | 'investment' | 'loan' | 'mortgage' | 'other'

/** `manual` accounts are kept by hand; `plaid` ones are linked to a bank, which updates them. */
export type AccountSource = 'manual' | 'plaid'

export interface Account {
  id: string
  name: string
  type: AccountType
  institution: string | null
  /** The last few digits of the account number, e.g. `4410`. */
  mask: string | null
  currency: string
  /**
   * Amounts travel as strings with two decimals, e.g. `-612.40`, to avoid float rounding.
   * Negative means money owed, as on a credit card or loan.
   */
  balance: string
  available_balance: string | null
  credit_limit: string | null
  balance_updated_at: string
  notes: string | null
  source: AccountSource
  /** The bank connection that keeps a linked account up to date. */
  connection_id: string | null
  /** The bank's own name for a linked account, e.g. "Platinum Rewards Visa Signature". */
  official_name: string | null
  subtype: string | null
  closed_at: string | null
  created_at: string
  transaction_count: number
}

export interface AccountInput {
  name: string
  type: AccountType
  institution: string | null
  mask: string | null
  /** Leave out for the household's currency. */
  currency?: string
  balance: string
  credit_limit: string | null
  notes: string | null
}

/** Leave a field out to keep it. A linked account only changes its name, notes and whether it's closed. */
export interface AccountChanges extends Partial<AccountInput> {
  closed?: boolean
}

export const fetchAccounts = () => apiGet<Account[]>('/accounts')
export const createAccount = (input: AccountInput) => apiPost<Account>('/accounts', input)
export const updateAccount = (id: string, changes: AccountChanges) =>
  apiPatch<Account>(`/accounts/${id}`, changes)
export const deleteAccount = (id: string) => apiDelete(`/accounts/${id}`)
