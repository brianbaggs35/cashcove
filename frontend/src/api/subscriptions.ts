import { apiDelete, apiGet, apiPatch, apiPost, apiRequest } from '@/api/client'

export type PaymentFrequency =
  'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export interface Subscription {
  id: string
  name: string
  payee: string
  /** Amounts travel as decimal strings, never floating-point numbers. */
  amount: string
  /** The amount is a different one each time, like a utility bill, so `amount` is an estimate. */
  amount_varies: boolean
  frequency: PaymentFrequency
  account_id: string
  next_due_date: string
  category_id: string | null
  notes: string | null
  active: boolean
  payment_count: number
  /** The day of the latest payment linked to it, which moves its due date along, and what it was for. */
  last_payment_on: string | null
  last_payment_amount: string | null
  /** What its recent payments average. */
  typical_amount: string | null
  /** What its next payment is expected to be: `amount`, or for one that varies, the typical amount. */
  expected_amount: string | null
  created_at: string
  updated_at: string
}

/** What linking payments did: how many changed, and the subscription as it is now. */
export interface PaymentsLinked {
  count: number
  subscription: Subscription
}

export interface SubscriptionInput {
  name: string
  amount: string
  amount_varies: boolean
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
/** Links payments, from any account, to a subscription. They take its category. */
export const linkSubscriptionPayments = (id: string, transactionIds: string[]) =>
  apiPost<PaymentsLinked>(`/subscriptions/${id}/payments`, { ids: transactionIds })
/** Takes a payment off a subscription. It keeps its category. */
export const unlinkSubscriptionPayment = (id: string, transactionId: string) =>
  apiRequest<Subscription>('DELETE', `/subscriptions/${id}/payments/${transactionId}`)
