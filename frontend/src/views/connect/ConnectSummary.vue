<script setup lang="ts">
import { CalendarClock, CircleCheck, Landmark, RefreshCw, TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'

import type { Connection } from '@/api/connections'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { usePreferencesStore } from '@/stores/preferences'

/** The connected banks at a glance: how many, whether they're healthy, and when they sync. */
const props = defineProps<{ connections: Connection[] }>()

const preferences = usePreferencesStore()

const attention = computed(
  () => props.connections.filter((connection) => connection.status !== 'healthy').length,
)
const imported = computed(() =>
  props.connections.reduce(
    (total, connection) =>
      total + connection.accounts.filter((account) => account.state === 'imported').length,
    0,
  ),
)
const shared = computed(() =>
  props.connections.reduce((total, connection) => total + connection.accounts.length, 0),
)

/** The latest or earliest of some times, e.g. `Math.max` for the most recent. */
function pickTime(values: (string | null)[], pick: (...times: number[]) => number) {
  const times = values.filter((value): value is string => !!value).map((value) => Date.parse(value))
  return times.length ? new Date(pick(...times)).toISOString() : null
}

const lastSynced = computed(() =>
  pickTime(
    props.connections.map((connection) => connection.last_synced_at),
    Math.max,
  ),
)
const nextSync = computed(() =>
  pickTime(
    props.connections.map((connection) => connection.next_sync_at),
    Math.min,
  ),
)
const autoSyncOff = computed(() => preferences.saved?.sync.auto_sync === false)
</script>

<template>
  <div class="connect-summary mb-6" data-test="connect-summary">
    <v-card class="connect-summary__tile pa-4">
      <div class="connect-summary__label">
        <v-icon :icon="Landmark" size="16" />
        Banks
      </div>
      <div class="connect-summary__value" data-test="connect-summary-banks">
        {{ connections.length }}
      </div>
      <div
        class="connect-summary__note"
        :class="attention ? 'text-warning' : 'text-success'"
        data-test="connect-summary-health"
      >
        <v-icon :icon="attention ? TriangleAlert : CircleCheck" size="14" />
        {{ attention ? `${attention} need${attention === 1 ? 's' : ''} attention` : 'All healthy' }}
      </div>
    </v-card>
    <v-card class="connect-summary__tile pa-4">
      <div class="connect-summary__label">
        <v-icon :icon="CircleCheck" size="16" />
        Accounts imported
      </div>
      <div class="connect-summary__value" data-test="connect-summary-accounts">{{ imported }}</div>
      <div class="connect-summary__note text-medium-emphasis">of {{ shared }} shared</div>
    </v-card>
    <v-card class="connect-summary__tile pa-4">
      <div class="connect-summary__label">
        <v-icon :icon="RefreshCw" size="16" />
        Last sync
      </div>
      <div
        class="connect-summary__value connect-summary__value--text"
        data-test="connect-summary-last"
      >
        <RelativeTime v-if="lastSynced" :value="lastSynced" />
        <template v-else>Not yet</template>
      </div>
      <div class="connect-summary__note text-medium-emphasis">across every bank</div>
    </v-card>
    <v-card class="connect-summary__tile pa-4">
      <div class="connect-summary__label">
        <v-icon :icon="CalendarClock" size="16" />
        Next sync
      </div>
      <div
        class="connect-summary__value connect-summary__value--text"
        data-test="connect-summary-next"
      >
        <RelativeTime v-if="nextSync" :value="nextSync" />
        <template v-else-if="autoSyncOff">Off</template>
        <template v-else>Not scheduled</template>
      </div>
      <router-link to="/settings/sync" class="connect-summary__note connect-summary__link">
        {{ autoSyncOff ? 'Turn on automatic sync' : 'Change the schedule' }}
      </router-link>
    </v-card>
  </div>
</template>

<style scoped>
.connect-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 959px) {
  .connect-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
}

.connect-summary__label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.connect-summary__value {
  margin-top: 4px;
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

.connect-summary__value--text {
  font-size: 1.25rem;
  line-height: 1.68;
}

.connect-summary__note {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 0.8125rem;
}

.connect-summary__link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.connect-summary__link:hover,
.connect-summary__link:focus-visible {
  text-decoration: underline;
}
</style>
