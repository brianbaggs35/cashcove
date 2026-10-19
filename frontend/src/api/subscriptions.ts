import type { BudgetPeriodKind } from '@/api/budget'
import { apiDelete, apiGet, apiPatch, apiPost, apiRequest } from '@/api/client'

/** Bi-monthly is every two months, the way biweekly is every two weeks: not twice a month. */
export type PaymentFrequency =
  'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual'

/**
 * What a recurring payment is called: a subscription, like a streaming plan, or a bill, like
 * electricity. They're tracked, matched to transactions and sorted by automations the same way,
 * so both have the shape of a `Subscription`, and `kind` says which page lists it.
 */
export type RecurringKind = 'subscription' | 'bill'

/** A recurring payment: a subscription or, as `kind` says, a bill. */
export interface Subscription {
  id: string
  name: string
  kind: RecurringKind
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
  /**
   * The day it ends: no payment is expected on or after it, and once it has come it is over. Null
   * when it carries on. Nothing ends it but the date, so whether it has is read against today.
   */
  ends_on: string | null
  /** The day it was cancelled. A cancelled one always has an `ends_on`, and can be reactivated. */
  cancelled_on: string | null
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

/** What the payments linked to a subscription or bill came to, as what was paid. */
export interface PaymentSummary {
  total: string
  /** The rest are null until it has a payment. */
  average: string | null
  highest: string | null
  lowest: string | null
  first_on: string | null
  /** What was paid in the calendar year the person is in. */
  this_year: string
}

/** One payment on a chart of what a subscription or bill has cost. */
export interface PaymentPoint {
  on: string
  amount: string
}

/** A payment that is coming, counted on from the next one. */
export interface UpcomingPayment {
  due_on: string
  amount: string
}

/** An automation that links payments to a subscription or bill. */
export interface LinkedAutomation {
  id: string
  name: string
  active: boolean
}

/** A budget that counts a subscription's or bill's payments as spending. */
export interface LinkedBudget {
  id: string
  name: string
  period: BudgetPeriodKind
}

/** Everything its own page shows: it, what it has cost, what is coming and what refers to it. */
export interface RecurringOverview {
  subscription: Subscription
  summary: PaymentSummary
  /** The latest payments, the oldest first. */
  history: PaymentPoint[]
  upcoming: UpcomingPayment[]
  automations: LinkedAutomation[]
  budgets: LinkedBudget[]
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
  /** When it ends, if it does; null for one that carries on. */
  ends_on: string | null
  category_id: string | null
  notes: string | null
  payee: string
  seed_transaction_id: string | null
}

/** Cancelling keeps a subscription and everything it tracked. */
export interface CancelInput {
  /** The day it was cancelled, where the person is. */
  cancelled_on: string
  /** The day it ends: no payment is expected on or after it. */
  ends_on: string
}

/** Reactivating picks a cancelled or ended subscription up again, to work like a regular one. */
export interface ReactivateInput {
  /** The day its next payment is due. */
  next_due_date: string
  /** The day it is where the person is, which says whether it has ended. */
  today: string
}

export type SubscriptionChanges = Partial<SubscriptionInput> & { active?: boolean }

/** Which of them to list: all, or only the ones being tracked or only the paused. */
export const activeQuery = (active?: boolean) => (active === undefined ? '' : `?active=${active}`)

export const fetchSubscriptions = (active?: boolean) =>
  apiGet<Subscription[]>(`/subscriptions${activeQuery(active)}`)
/** It in full, as of `today`, which says which year the person is in. */
export const fetchSubscriptionOverview = (id: string, today: string) =>
  apiGet<RecurringOverview>(`/subscriptions/${id}/overview?today=${today}`)
export const createSubscription = (input: SubscriptionInput) =>
  apiPost<Subscription>('/subscriptions', input)
export const updateSubscription = (id: string, changes: SubscriptionChanges) =>
  apiPatch<Subscription>(`/subscriptions/${id}`, changes)
export const deleteSubscription = (id: string) => apiDelete(`/subscriptions/${id}`)
/** Cancels it, which keeps it and its payments: it just ends on the day given. */
export const cancelSubscription = (id: string, input: CancelInput) =>
  apiPost<Subscription>(`/subscriptions/${id}/cancellation`, input)
/** Picks a cancelled or ended one up again: no end date, tracked again, next due as given. */
export const reactivateSubscription = (id: string, input: ReactivateInput) =>
  apiPost<Subscription>(`/subscriptions/${id}/reactivation`, input)
/** Links payments, from any account, to a subscription. They take its category. */
export const linkSubscriptionPayments = (id: string, transactionIds: string[]) =>
  apiPost<PaymentsLinked>(`/subscriptions/${id}/payments`, { ids: transactionIds })
/** Takes a payment off a subscription. It keeps its category. */
export const unlinkSubscriptionPayment = (id: string, transactionId: string) =>
  apiRequest<Subscription>('DELETE', `/subscriptions/${id}/payments/${transactionId}`)
