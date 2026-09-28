import { computed } from 'vue'

import { useConnectionsStore } from '@/stores/connections'
import { usePreferencesStore } from '@/stores/preferences'

/**
 * How many connected banks need attention, for the navigation to point out. It's zero when
 * Settings > Alerts turns sync problem alerts off.
 */
export function useConnectionAlerts() {
  const connections = useConnectionsStore()
  const preferences = usePreferencesStore()
  const count = computed(() =>
    preferences.saved?.alerts.sync_failure_enabled === false ? 0 : connections.attention.length,
  )
  const label = computed(() =>
    count.value === 1 ? '1 bank needs attention' : `${count.value} banks need attention`,
  )
  return { count, label }
}
