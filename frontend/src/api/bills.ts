import { apiDelete, apiGet, apiPatch, apiPost, apiRequest } from '@/api/client'
import {
  activeQuery,
  type PaymentsLinked,
  type Subscription,
  type SubscriptionChanges,
  type SubscriptionInput,
} from '@/api/subscriptions'

/** A bill has the shape of a subscription, since both are recurring payments. */
export type Bill = Subscription

export const fetchBills = (active?: boolean) => apiGet<Bill[]>(`/bills${activeQuery(active)}`)
export const createBill = (input: SubscriptionInput) => apiPost<Bill>('/bills', input)
export const updateBill = (id: string, changes: SubscriptionChanges) =>
  apiPatch<Bill>(`/bills/${id}`, changes)
export const deleteBill = (id: string) => apiDelete(`/bills/${id}`)
/** Links payments, from any account, to a bill. They take its category. */
export const linkBillPayments = (id: string, transactionIds: string[]) =>
  apiPost<PaymentsLinked>(`/bills/${id}/payments`, { ids: transactionIds })
/** Takes a payment off a bill. It keeps its category. */
export const unlinkBillPayment = (id: string, transactionId: string) =>
  apiRequest<Bill>('DELETE', `/bills/${id}/payments/${transactionId}`)
