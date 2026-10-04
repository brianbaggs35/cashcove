import { computed } from 'vue'

import { usePreferencesStore } from '@/stores/preferences'

/** How close to its amount a budget has to be spent for it to be called close, or null when the household turned that off. */
export function useBudgetThreshold() {
  const preferences = usePreferencesStore()
  return computed(() => {
    const alerts = preferences.saved?.alerts
    return alerts?.budget_threshold_enabled ? alerts.budget_threshold_percent : null
  })
}
