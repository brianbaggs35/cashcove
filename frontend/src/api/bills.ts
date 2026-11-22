import { apiDelete, apiGet, apiPatch, apiPost, apiRequest } from '@/api/client'
import {
  activeQuery,
  type ArchiveInput,
  type CancelInput,
  type PaymentsLinked,
  type ReactivateInput,
  type RecurringOverview,
  type Subscription,
  type SubscriptionChanges,
  type SubscriptionInput,
} from '@/api/subscriptions'

/** A bill has the shape of a subscription, since both are recurring payments. */
export type Bill = Subscription

export const fetchBills = (active?: boolean) => apiGet<Bill[]>(`/bills${activeQuery(active)}`)
/** It in full, as of `today`, which says which year the person is in. */
export const fetchBillOverview = (id: string, today: string) =>
  apiGet<RecurringOverview>(`/bills/${id}/overview?today=${today}`)
export const createBill = (input: SubscriptionInput) => apiPost<Bill>('/bills', input)
export const updateBill = (id: string, changes: SubscriptionChanges) =>
  apiPatch<Bill>(`/bills/${id}`, changes)
export const deleteBill = (id: string) => apiDelete(`/bills/${id}`)
/** Cancels it, which keeps it and its payments: it just ends on the day given. */
export const cancelBill = (id: string, input: CancelInput) =>
  apiPost<Bill>(`/bills/${id}/cancellation`, input)
/** Picks a cancelled or ended one up again: no end date, tracked again, next due as given. */
export const reactivateBill = (id: string, input: ReactivateInput) =>
  apiPost<Bill>(`/bills/${id}/reactivation`, input)
/** Puts it away, which keeps it and its payments: a tracked one is paused, so it is out of the way. */
export const archiveBill = (id: string, input: ArchiveInput) =>
  apiPost<Bill>(`/bills/${id}/archiving`, input)
/** Brings it back out of the archive, as it was: paused or cancelled, if that is what it was. */
export const unarchiveBill = (id: string) => apiPost<Bill>(`/bills/${id}/unarchiving`)
/** Links payments, from any account, to a bill. They take its category. */
export const linkBillPayments = (id: string, transactionIds: string[]) =>
  apiPost<PaymentsLinked>(`/bills/${id}/payments`, { ids: transactionIds })
/** Takes a payment off a bill. It keeps its category. */
export const unlinkBillPayment = (id: string, transactionId: string) =>
  apiRequest<Bill>('DELETE', `/bills/${id}/payments/${transactionId}`)
