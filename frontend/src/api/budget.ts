import { apiDelete, apiGet, apiPut } from '@/api/client'
import { queryString } from '@/api/transactions'

export type BudgetPeriod = 'weekly' | 'biweekly' | 'monthly' | 'yearly'
export type CategoryKind = 'income' | 'expense' | 'transfer'

export interface BudgetLine {
  category_id: string
  name: string
  emoji: string
  period: BudgetPeriod | null
  amount: string | null
  budgeted: string
  rollover: boolean
  carried: string
  actual: string
  year_to_date: string | null
  average: string
  count: number
}

export interface BudgetGroup {
  id: string
  name: string
  kind: CategoryKind
  categories: BudgetLine[]
}

export interface BudgetTotals {
  budgeted: string
  carried: string
  actual: string
}

export interface BudgetMonth {
  month: string
  currency: string
  year: number
  year_start: string
  year_end: string
  income: BudgetTotals
  spending: BudgetTotals
  groups: BudgetGroup[]
  uncategorized: { received: string; spent: string; count: number }
  other_currencies: string[]
}

export interface BudgetYear {
  year: number
  start: string
  end: string
  currency: string
  income: { budgeted: string; actual: string }
  spending: { budgeted: string; actual: string }
  months: {
    month: string
    income: { budgeted: string; actual: string }
    spending: { budgeted: string; actual: string }
  }[]
}

export interface BudgetConfiguration {
  id: string
  category_id: string
  period: BudgetPeriod
  amount: string | null
  rollover: boolean
  cycle_anchor: string | null
  account_ids: string[]
  linked_transaction_ids: string[]
  linked_subscription_ids: string[]
}

export interface BudgetChange {
  month: string
  period: BudgetPeriod
  amount: string | null
  scope: 'onward' | 'only'
  rollover: boolean
  cycle_anchor: string | null
  account_ids: string[]
}

export const fetchBudgetMonth = (month: string) => apiGet<BudgetMonth>(`/budget/months/${month}`)
export const fetchBudgetYear = (year: number) => apiGet<BudgetYear>(`/budget/years/${year}`)
export const fetchBudgetConfigurations = (month: string) =>
  apiGet<BudgetConfiguration[]>(`/budget/configurations${queryString({ month })}`)
export const saveCategoryBudget = (categoryId: string, change: BudgetChange) =>
  apiPut<BudgetMonth>(`/budget/categories/${categoryId}`, change)
export const deleteCategoryBudget = (categoryId: string) =>
  apiDelete(`/budget/categories/${categoryId}`)
export const linkBudgetTransaction = (categoryId: string, transactionId: string) =>
  apiPut<undefined>(`/budget/categories/${categoryId}/transactions/${transactionId}`, {})
export const unlinkBudgetTransaction = (categoryId: string, transactionId: string) =>
  apiDelete(`/budget/categories/${categoryId}/transactions/${transactionId}`)
export const linkBudgetSubscription = (categoryId: string, subscriptionId: string) =>
  apiPut<undefined>(`/budget/categories/${categoryId}/subscriptions/${subscriptionId}`, {})
export const unlinkBudgetSubscription = (categoryId: string, subscriptionId: string) =>
  apiDelete(`/budget/categories/${categoryId}/subscriptions/${subscriptionId}`)
