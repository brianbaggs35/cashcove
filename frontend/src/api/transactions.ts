import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'

/** Entered by hand, synced from the bank through Plaid, or imported from a file. */
export type TransactionSource = 'manual' | 'plaid' | 'file'

export interface Transaction {
  id: string
  account_id: string
  /** The day it happened, e.g. `2026-09-20`. */
  date: string
  /** Positive for money in, negative for money out, with two decimals, e.g. `-84.12`. */
  amount: string
  payee: string
  /** What the bank called it, e.g. "WHOLEFDS MKT #10234". */
  original_description: string | null
  category_id: string | null
  subscription_id: string | null
  notes: string | null
  /** The bank hasn't settled it yet, so it may still change. */
  pending: boolean
  source: TransactionSource
  /** The file it was imported from, while that import can still be undone. */
  import_id: string | null
  created_at: string
  updated_at: string
}

export type TransactionSort = 'date' | '-date' | 'amount' | '-amount' | 'payee' | '-payee'

/** Which transactions to list. Everything is optional; lists match any of their values. */
export interface TransactionQuery {
  page?: number
  page_size?: number
  /** Searches payees, the bank's descriptions, notes, category names and amounts. */
  q?: string
  account_id?: string[]
  category_id?: string[]
  /** Transactions without a category, alongside any in `category_id`. */
  uncategorized?: boolean
  /** From and to these days, inclusive, e.g. `2026-09-01`. */
  start?: string
  end?: string
  direction?: 'in' | 'out'
  status?: 'pending' | 'posted'
  source?: TransactionSource[]
  /** Only the transactions one import added. */
  import_id?: string
  subscription_id?: string
  /** However the money went, e.g. `50` matches both 50.00 in and 50.00 out. */
  min_amount?: string
  max_amount?: string
  sort?: TransactionSort
}

/** What the matching transactions add up to, for one currency. */
export interface TransactionTotals {
  currency: string
  count: number
  money_in: string
  money_out: string
}

export interface TransactionPage {
  items: Transaction[]
  total: number
  page: number
  page_size: number
  totals: TransactionTotals[]
}

/** A payee used before, and the category it last had. */
export interface PayeeSuggestion {
  payee: string
  category_id: string | null
  count: number
}

export interface TransactionInput {
  account_id: string
  date: string
  amount: string
  payee: string
  category_id: string | null
  notes: string | null
}

export interface BulkResult {
  count: number
}

/** The query string for a list request: lists repeat their key, empty values are left out. */
export function queryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query) as [string, unknown][]) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null && item !== '' && item !== false) {
        params.append(key, String(item))
      }
    }
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const fetchTransactions = (query: TransactionQuery = {}) =>
  apiGet<TransactionPage>(`/transactions${queryString(query)}`)
export const fetchTransaction = (id: string) => apiGet<Transaction>(`/transactions/${id}`)
export const fetchPayees = (q = '', limit = 8) =>
  apiGet<PayeeSuggestion[]>(`/transactions/payees${queryString({ q: q.trim(), limit })}`)
export const createTransaction = (input: TransactionInput) =>
  apiPost<Transaction>('/transactions', input)
/** Leave a field out to keep it. Plaid's own transactions only change payee, category and notes. */
export const updateTransaction = (id: string, changes: Partial<TransactionInput>) =>
  apiPatch<Transaction>(`/transactions/${id}`, changes)
export const deleteTransaction = (id: string) => apiDelete(`/transactions/${id}`)
export const deleteTransactions = (ids: string[]) =>
  apiPost<BulkResult>('/transactions/bulk/delete', { ids })
export const categorizeTransactions = (ids: string[], categoryId: string | null) =>
  apiPost<BulkResult>('/transactions/bulk/categorize', { ids, category_id: categoryId })
