import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/preferences'
import { useHousehold } from '@/composables/useHousehold'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences } from '@/test/fixtures'

describe('useHousehold', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('formats money in the household currency once preferences load', async () => {
    const preferences = makePreferences()
    preferences.general.currency = 'EUR'
    preferences.general.locale = 'de-DE'
    const fetch = vi.spyOn(api, 'fetchPreferences').mockResolvedValue(preferences)

    const household = useHousehold()
    // Until then, amounts read as US dollars.
    expect(household.money('1234.5')).toBe('$1,234.50')
    // A second component asking at the same time doesn't load them again.
    useHousehold()
    await vi.waitFor(() => {
      expect(household.currency.value).toBe('EUR')
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(household.locale.value).toBe('de-DE')
    expect(household.money('1234.5')).toBe('1.234,50 €')
    expect(household.money('12', 'USD', 'exceptZero')).toBe('+12,00 $')
  })

  it('uses preferences that already loaded', () => {
    const fetch = vi.spyOn(api, 'fetchPreferences')
    usePreferencesStore().saved = makePreferences()

    expect(useHousehold().currency.value).toBe('USD')
    expect(fetch).not.toHaveBeenCalled()
  })
})
