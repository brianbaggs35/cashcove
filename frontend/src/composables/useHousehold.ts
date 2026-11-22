import { computed } from 'vue'

import { usePreferencesStore } from '@/stores/preferences'
import { formatMoney } from '@/utils/format'

/**
 * The household's currency, number format and first day of the week, for showing and reading
 * amounts and dates. Loads the household's preferences if nothing has yet; until then, amounts
 * read as US dollars and weeks start on Sunday.
 */
export function useHousehold() {
  const preferences = usePreferencesStore()
  if (!preferences.saved && !preferences.loading) void preferences.load()

  const currency = computed(() => preferences.saved?.general.currency ?? 'USD')
  const locale = computed(() => preferences.saved?.general.locale ?? 'en-US')
  const weekStartsOn = computed(() => preferences.saved?.general.week_starts_on ?? 'sunday')

  /** An amount in `currencyCode`, the household's currency unless said otherwise. */
  function money(
    amount: string | number,
    currencyCode: string = currency.value,
    signDisplay: 'auto' | 'exceptZero' | 'never' = 'auto',
  ): string {
    return formatMoney(amount, currencyCode, locale.value, { signDisplay })
  }

  return { currency, locale, weekStartsOn, money }
}
