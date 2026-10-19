import * as bills from '@/api/bills'
import * as subscriptions from '@/api/subscriptions'
import type {
  CancelInput,
  PaymentsLinked,
  ReactivateInput,
  RecurringKind,
  RecurringOverview,
  Subscription,
  SubscriptionChanges,
  SubscriptionInput,
} from '@/api/subscriptions'

/** What can be done with one kind of recurring payment, the same for both. */
export interface RecurringApi {
  fetch: (active?: boolean) => Promise<Subscription[]>
  /** One in full, as of `today`: what it has cost, what is coming and what refers to it. */
  overview: (id: string, today: string) => Promise<RecurringOverview>
  create: (input: SubscriptionInput) => Promise<Subscription>
  update: (id: string, changes: SubscriptionChanges) => Promise<Subscription>
  remove: (id: string) => Promise<void>
  /** Ends it without deleting it: it and its payments are kept. */
  cancel: (id: string, input: CancelInput) => Promise<Subscription>
  /** Picks a cancelled or ended one up again, to work like a regular one. */
  reactivate: (id: string, input: ReactivateInput) => Promise<Subscription>
  link: (id: string, transactionIds: string[]) => Promise<PaymentsLinked>
  unlink: (id: string, transactionId: string) => Promise<Subscription>
}

/**
 * The calls for a subscription or a bill, so the pages and dialogs they share don't care which
 * they have. Each goes through the module's own function when it's called.
 */
export function recurringApi(kind: RecurringKind): RecurringApi {
  if (kind === 'bill') {
    return {
      fetch: (active) => bills.fetchBills(active),
      overview: (id, today) => bills.fetchBillOverview(id, today),
      create: (input) => bills.createBill(input),
      update: (id, changes) => bills.updateBill(id, changes),
      remove: (id) => bills.deleteBill(id),
      cancel: (id, input) => bills.cancelBill(id, input),
      reactivate: (id, input) => bills.reactivateBill(id, input),
      link: (id, ids) => bills.linkBillPayments(id, ids),
      unlink: (id, transactionId) => bills.unlinkBillPayment(id, transactionId),
    }
  }
  return {
    fetch: (active) => subscriptions.fetchSubscriptions(active),
    overview: (id, today) => subscriptions.fetchSubscriptionOverview(id, today),
    create: (input) => subscriptions.createSubscription(input),
    update: (id, changes) => subscriptions.updateSubscription(id, changes),
    remove: (id) => subscriptions.deleteSubscription(id),
    cancel: (id, input) => subscriptions.cancelSubscription(id, input),
    reactivate: (id, input) => subscriptions.reactivateSubscription(id, input),
    link: (id, ids) => subscriptions.linkSubscriptionPayments(id, ids),
    unlink: (id, transactionId) => subscriptions.unlinkSubscriptionPayment(id, transactionId),
  }
}
