import * as bills from '@/api/bills'
import * as subscriptions from '@/api/subscriptions'
import type {
  PaymentsLinked,
  RecurringKind,
  Subscription,
  SubscriptionChanges,
  SubscriptionInput,
} from '@/api/subscriptions'

/** What can be done with one kind of recurring payment, the same for both. */
export interface RecurringApi {
  fetch: (active?: boolean) => Promise<Subscription[]>
  create: (input: SubscriptionInput) => Promise<Subscription>
  update: (id: string, changes: SubscriptionChanges) => Promise<Subscription>
  remove: (id: string) => Promise<void>
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
      create: (input) => bills.createBill(input),
      update: (id, changes) => bills.updateBill(id, changes),
      remove: (id) => bills.deleteBill(id),
      link: (id, ids) => bills.linkBillPayments(id, ids),
      unlink: (id, transactionId) => bills.unlinkBillPayment(id, transactionId),
    }
  }
  return {
    fetch: (active) => subscriptions.fetchSubscriptions(active),
    create: (input) => subscriptions.createSubscription(input),
    update: (id, changes) => subscriptions.updateSubscription(id, changes),
    remove: (id) => subscriptions.deleteSubscription(id),
    link: (id, ids) => subscriptions.linkSubscriptionPayments(id, ids),
    unlink: (id, transactionId) => subscriptions.unlinkSubscriptionPayment(id, transactionId),
  }
}
