import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'
import type { RecurringKind } from '@/api/subscriptions'

/** How often a budget's amount starts over. */
export type BudgetPeriodKind = 'weekly' | 'biweekly' | 'monthly' | 'yearly'

/** What something counted toward a budget counts as. */
export type BudgetKind = 'income' | 'spending'

/** What a source of a budget is, besides single transactions. */
export type SourceType = 'account' | 'category' | 'subscription' | 'bill' | 'automation'

/**
 * Why a transaction counts: it was linked itself, or one of the sources counts it. The payments
 * of a bill count via the subscription link, since both are linked the same way.
 */
export type Via = 'transaction' | Exclude<SourceType, 'bill'>

/** What a budget came to in one of its periods. */
export interface PeriodSummary {
  start: string
  end: string
  amount: string
  income: string
  spent: string
}

export interface Budget {
  id: string
  name: string
  period: BudgetPeriodKind
  /** A day its periods count from. */
  starts_on: string
  /** What it has for each period now, and how the period the person is in is going. */
  amount: string
  current: PeriodSummary
  created_at: string
  updated_at: string
}

export interface BudgetInput {
  name: string
  period: BudgetPeriodKind
  amount: string
  /** The usual start for the period when null or left out. */
  starts_on?: string | null
  /** The date where the person is, which says which period they're in. */
  today?: string
}

/** Leave a field out to keep it. */
export type BudgetChanges = Partial<BudgetInput>

/** Something to count toward a budget, other than single transactions. Name exactly one. */
export interface BudgetSourceInput {
  kind: BudgetKind
  account_id?: string
  category_id?: string
  subscription_id?: string
  automation_id?: string
}

/** A source of a budget. */
export interface BudgetLink {
  id: string
  kind: BudgetKind
  type: SourceType
  target_id: string
  name: string
  /** Paused, for an automation or a subscription, which counts nothing until it's resumed. */
  active: boolean
}

/** A source, and what it counted in the period being looked at. */
export interface BudgetSource extends BudgetLink {
  amount: string
  count: number
}

export interface DayTotal {
  day: string
  income: string
  spent: string
}

/** What was spent in a category, or with none. */
export interface CategoryTotal {
  category_id: string | null
  amount: string
  count: number
}

/** A subscription's or bill's payment that falls due before the period ends. */
export interface UpcomingBill {
  subscription_id: string
  name: string
  /** Whether it's a subscription or a bill. */
  kind: RecurringKind
  due_on: string
  amount: string
}

/** One period of a budget: how it's going, or how it went. */
export interface BudgetPeriodView {
  budget: Budget
  start: string
  end: string
  /** The first days of the periods either side that can be looked at. */
  previous: string | null
  next: string | null
  /** The period the person is in. */
  current: boolean
  days: number
  /** How many days have gone, today's included. */
  days_gone: number
  amount: string
  income: string
  spent: string
  /** What's left of the amount, which is negative when more was spent than that. */
  left: string
  /** What came in, less what was spent. */
  saved: string
  /** For the current period: what an even pace would have spent by now, and what it comes to at the pace so far. */
  expected: string | null
  projected: string | null
  /** How many transactions count, and how many that would count were taken off. */
  transactions: number
  removed: number
  daily: DayTotal[]
  categories: CategoryTotal[]
  sources: BudgetSource[]
  upcoming: UpcomingBill[]
  /** Currencies that were converted, and ones that couldn't be and so aren't counted. */
  converted: string[]
  unavailable: string[]
}

export interface HistoryPeriod {
  start: string
  end: string
  amount: string
  income: string
  spent: string
  current: boolean
}

export interface BudgetHistory {
  periods: HistoryPeriod[]
  converted: string[]
  unavailable: string[]
}

/** A transaction that counts toward a budget, or that would if it hadn't been taken off. */
export interface BudgetTransaction {
  id: string
  date: string
  payee: string
  amount: string
  account_id: string
  category_id: string | null
  kind: BudgetKind
  via: Via
  /** The source it counts through, when it isn't linked itself. */
  source_id: string | null
}

export interface BudgetTransactionPage {
  items: BudgetTransaction[]
  total: number
}

/** Which period to look at, and where the person is. */
export interface PeriodQuery {
  /** Any day in the period; today's by default. */
  on?: string
  today: string
}

export interface TransactionsQuery extends PeriodQuery {
  kind?: BudgetKind
  /** The ones taken off that would otherwise count. */
  removed?: boolean
  page?: number
  pageSize?: number
}

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) params.set(name, String(value))
  }
  return `?${params.toString()}`
}

export const fetchBudgets = (today: string) => apiGet<Budget[]>(`/budgets${query({ today })}`)
export const createBudget = (input: BudgetInput) => apiPost<Budget>('/budgets', input)
export const updateBudget = (id: string, changes: BudgetChanges) =>
  apiPatch<Budget>(`/budgets/${id}`, changes)
/** Deletes a budget and what's linked to it. Nothing that counted toward it changes. */
export const deleteBudget = (id: string) => apiDelete(`/budgets/${id}`)

export const fetchBudgetPeriod = (id: string, { on, today }: PeriodQuery) =>
  apiGet<BudgetPeriodView>(`/budgets/${id}/period${query({ on, today })}`)
export const fetchBudgetHistory = (id: string, { on, today }: PeriodQuery, count = 12) =>
  apiGet<BudgetHistory>(`/budgets/${id}/history${query({ on, today, count })}`)
export const fetchBudgetTransactions = (
  id: string,
  { on, today, kind, removed, page, pageSize }: TransactionsQuery,
) =>
  apiGet<BudgetTransactionPage>(
    `/budgets/${id}/transactions${query({ on, today, kind, removed, page, page_size: pageSize })}`,
  )

/** Counts transactions toward a budget; ones that were taken off are put back. */
export const linkBudgetTransactions = (id: string, ids: string[], kind: BudgetKind) =>
  apiPost<{ count: number }>(`/budgets/${id}/transactions`, { ids, kind })
/** Takes a transaction off a budget, even when a source counts it. */
export const unlinkBudgetTransaction = (id: string, transactionId: string) =>
  apiDelete(`/budgets/${id}/transactions/${transactionId}`)

export const addBudgetSource = (id: string, input: BudgetSourceInput) =>
  apiPost<BudgetLink>(`/budgets/${id}/sources`, input)
export const removeBudgetSource = (id: string, sourceId: string) =>
  apiDelete(`/budgets/${id}/sources/${sourceId}`)
