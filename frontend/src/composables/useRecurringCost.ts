import { computed, type ComputedRef } from 'vue'

import type { Subscription } from '@/api/subscriptions'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { costs } from '@/views/subscriptions/recurrence'

/**
 * What a subscription or a bill costs, in words and in the currency of the account it is paid
 * from: "about $14.99 a month, $179.88 a year". Null until there is one to ask about.
 */
export function useRecurringCost(
  subscription: () => Subscription | null,
): ComputedRef<string | null> {
  const accounts = useAccountsStore()
  const { money } = useHousehold()
  return computed(() => {
    const item = subscription()
    if (!item) return null
    const currency = accounts.find(item.account_id)?.currency
    const { month, year } = costs(item)
    return `about ${money(month, currency)} a month, ${money(year, currency)} a year`
  })
}
