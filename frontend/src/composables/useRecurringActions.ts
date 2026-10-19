import { Unlink } from '@lucide/vue'

import { errorMessage } from '@/api/client'
import { recurringApi } from '@/api/recurring'
import type { Subscription } from '@/api/subscriptions'
import type { Transaction } from '@/api/transactions'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useHousehold } from '@/composables/useHousehold'
import { kinds } from '@/views/subscriptions/kinds'
import { standing } from '@/views/subscriptions/recurrence'

/**
 * Takes a payment off a subscription or a bill, once the person has confirmed it: the payment
 * stays in their history with its category, but no longer counts toward it. Any page that lets
 * someone unlink a payment goes through this, so it is always asked and always worded alike.
 * Resolves to the subscription as it is now, or null if they thought better of it. If it fails,
 * the confirmation stays up with why, so they can try again.
 */
export async function unlinkPayment(
  subscription: Subscription,
  payment: Pick<Transaction, 'id' | 'payee'>,
): Promise<Subscription | null> {
  const done = await confirmAndRun(
    {
      title: `Unlink ${payment.payee}?`,
      text: `It stays in your history with its category, but no longer counts toward ${subscription.name}, its total or the budgets that count it.`,
      confirmText: 'Unlink payment',
      tone: 'error',
      icon: Unlink,
    },
    () => recurringApi(subscription.kind).unlink(subscription.id, payment.id),
  )
  if (!done) return null
  notify(`Unlinked ${payment.payee} from ${subscription.name}`)
  return done.result
}

/**
 * Deletes a subscription or a bill, once the person has confirmed it, which removes it and
 * everything set up for it: its payments stay in their history, but are no longer linked. One that
 * can still be cancelled is pointed to that, which keeps it and what it tracked. Resolves to
 * whether it was deleted, which is up to the caller to show.
 */
export async function deleteRecurring(subscription: Subscription): Promise<boolean> {
  const cancelInstead =
    standing(subscription) === 'cancelled'
      ? ''
      : ` To keep it and its history here, cancel the ${kinds[subscription.kind].noun} instead.`
  const done = await confirmAndRun(
    {
      title: `Delete ${subscription.name}?`,
      text: `This removes ${subscription.name} and everything set up for it: its settings, its notes and which payments are linked to it. It also comes out of any budget that counts it, and automations stop linking to it. The payments themselves will stay in your history, but will no longer be linked.${cancelInstead}`,
      confirmText: `Delete ${kinds[subscription.kind].noun}`,
      tone: 'error',
    },
    () => recurringApi(subscription.kind).remove(subscription.id),
  )
  if (!done) return false
  notify(`Deleted ${subscription.name}`)
  return true
}

/**
 * What an admin does to a subscription or a bill in one go, from its card or from its own page:
 * pause it or resume it, take a price change on board, or delete it. Cancelling and reactivating
 * each ask for a day, so they have dialogs of their own. `changed` runs after one of the first two
 * went through, to load it afresh, and `failed` hears why one didn't.
 */
export function useRecurringActions(
  changed: () => Promise<void>,
  failed: (message: string) => void,
) {
  const { money } = useHousehold()

  async function toggle(subscription: Subscription) {
    try {
      await recurringApi(subscription.kind).update(subscription.id, {
        active: !subscription.active,
      })
      notify(subscription.active ? 'Paused automatic matching' : 'Resumed automatic matching')
      await changed()
    } catch (updateError) {
      failed(errorMessage(updateError))
    }
  }

  /** A price rise, say: the amount a payment really was becomes the subscription's. */
  async function updateAmount(subscription: Subscription) {
    if (subscription.last_payment_amount === null) return
    try {
      await recurringApi(subscription.kind).update(subscription.id, {
        amount: subscription.last_payment_amount,
      })
      notify(`Updated ${subscription.name} to ${money(subscription.last_payment_amount)}`)
      await changed()
    } catch (updateError) {
      failed(errorMessage(updateError))
    }
  }

  return { toggle, updateAmount, remove: deleteRecurring }
}
