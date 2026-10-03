import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'
import { queryString, type TransactionPage } from '@/api/transactions'

export type PaymentFrequency =
  'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export interface Subscription {
  id: string
  name: string
  payee: string
  /** Amounts travel as decimal strings, never floating-point numbers. */
  amount: string
  frequency: PaymentFrequency
  account_id: string
  next_due_date: string
  category_id: string | null
  notes: string | null
  active: boolean
  payment_count: number
  created_at: string
  updated_at: string
}

export interface SubscriptionInput {
  name: string
  amount: string
  frequency: PaymentFrequency
  account_id: string
  next_due_date: string
  category_id: string | null
  notes: string | null
  payee: string
  seed_transaction_id: string | null
}

export type SubscriptionChanges = Partial<SubscriptionInput> & { active?: boolean }

export const fetchSubscriptions = (active?: boolean) => {
  const query = active === undefined ? '' : `?active=${active}`
  return apiGet<Subscription[]>(`/subscriptions${query}`)
}
export const createSubscription = (input: SubscriptionInput) =>
  apiPost<Subscription>('/subscriptions', input)
export const updateSubscription = (id: string, changes: SubscriptionChanges) =>
  apiPatch<Subscription>(`/subscriptions/${id}`, changes)
export const deleteSubscription = (id: string) => apiDelete(`/subscriptions/${id}`)
export const fetchSubscriptionPayments = (id: string) =>
  apiGet<TransactionPage>(
    `/transactions${queryString({ subscription_id: id, page_size: 5, sort: '-date' })}`,
  )
