import { useHousehold } from '@/composables/useHousehold'
import type { Subscription } from '@/api/subscriptions'
import { useAccountsStore } from '@/stores/accounts'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { expectedAmount, frequencyTitle } from '@/views/subscriptions/recurrence'

/** A subscription or a bill to choose, or the heading of the group it's in. */
export type RecurringChoice =
  | { type: 'subheader'; title: string }
  | { value: string; title: string; props: { subtitle: string } }

/**
 * The household's subscriptions and bills as the choices of a select, in a group each, for
 * linking a payment to one. Only the ones being tracked are offered.
 */
export function useRecurringChoices() {
  const store = useSubscriptionsStore()
  const accounts = useAccountsStore()
  const { money } = useHousehold()

  /** How often it's paid and what it comes to, e.g. "Monthly · $14.99". */
  function subtitle(item: Subscription): string {
    const currency = accounts.find(item.account_id)?.currency
    return `${frequencyTitle(item.frequency)} · ${money(expectedAmount(item), currency)}`
  }

  /**
   * The choices. One that's paused is still offered if it's `keep`, the one chosen now, so it
   * can be seen and taken off.
   */
  function choices(keep: string | null | undefined = null): RecurringChoice[] {
    const usable = (item: Subscription) => item.active || item.id === keep
    return [
      { title: 'Subscriptions', items: store.subscriptions.filter(usable) },
      { title: 'Bills', items: store.bills.filter(usable) },
    ].flatMap(({ title, items }) =>
      items.length
        ? [
            { type: 'subheader' as const, title },
            ...items.map((item) => ({
              value: item.id,
              title: item.name,
              props: { subtitle: subtitle(item) },
            })),
          ]
        : [],
    )
  }

  return { choices, subtitle }
}
