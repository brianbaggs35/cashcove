import { computed } from 'vue'

import { usePreferencesStore } from '@/stores/preferences'
import { formatMoney } from '@/utils/format'

/**
 * The household's currency and number format, for showing and reading amounts. Loads the
 * household's preferences if nothing has yet; until then, amounts read as US dollars.
 */
export function useHousehold() {
  const preferences = usePreferencesStore()
  if (!preferences.saved && !preferences.loading) void preferences.load()

  const currency = computed(() => preferences.saved?.general.currency ?? 'USD')
  const locale = computed(() => preferences.saved?.general.locale ?? 'en-US')

  /** An amount in `currencyCode`, the household's currency unless said otherwise. */
  function money(
    amount: string | number,
    currencyCode: string = currency.value,
    signDisplay: 'auto' | 'exceptZero' | 'never' = 'auto',
  ): string {
    return formatMoney(amount, currencyCode, locale.value, { signDisplay })
  }

  return { currency, locale, money }
}
