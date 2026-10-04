import { createPinia, setActivePinia } from 'pinia'

import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences } from '@/test/fixtures'
import { useBudgetThreshold } from '@/views/budget/status'

describe('the share of a budget that counts as close', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is what the household chose', () => {
    const preferences = usePreferencesStore()
    preferences.saved = makePreferences()
    preferences.saved.alerts.budget_threshold_percent = 80

    expect(useBudgetThreshold().value).toBe(80)
  })

  it('is nothing when the household turned the alert off, or has no preferences yet', () => {
    const preferences = usePreferencesStore()
    const threshold = useBudgetThreshold()
    expect(threshold.value).toBeNull()

    preferences.saved = makePreferences()
    preferences.saved.alerts.budget_threshold_enabled = false
    expect(threshold.value).toBeNull()
  })
})
