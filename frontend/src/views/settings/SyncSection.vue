<script setup lang="ts">
import { CloudOff, History, Plug, RefreshCw } from '@lucide/vue'
import { computed } from 'vue'

import { HISTORY_DAYS, SYNC_INTERVALS } from '@/api/preferences'
import { useHealthStore } from '@/stores/health'
import PreferencesGate from '@/views/settings/PreferencesGate.vue'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const healthStore = useHealthStore()
const plaid = computed(() => healthStore.system?.plaid)

const intervalLabel = (hours: number) =>
  hours === 24 ? 'Daily' : hours === 1 ? 'Every hour' : `Every ${hours} hours`
const intervals = SYNC_INTERVALS.map((hours) => ({ value: hours, title: intervalLabel(hours) }))

const historyLabels: Record<(typeof HISTORY_DAYS)[number], string> = {
  30: 'Last 30 days',
  90: 'Last 90 days',
  180: 'Last 6 months',
  365: 'Last year',
  730: 'Last 2 years (the most Plaid allows)',
}
const history = HISTORY_DAYS.map((days) => ({ value: days, title: historyLabels[days] }))
</script>

<template>
  <PreferencesGate v-slot="{ draft, readonly }">
    <SettingsCard
      title="Automatic sync"
      subtitle="Cashcove checks your linked banks for new transactions and balances on a schedule."
      :icon="RefreshCw"
    >
      <template #append>
        <v-switch
          v-model="draft.sync.auto_sync"
          color="primary"
          inset
          hide-details
          density="compact"
          aria-label="Automatic sync"
          data-test="auto-sync"
        />
      </template>
      <div class="text-label-large mb-3">How often</div>
      <v-chip-group
        v-model="draft.sync.interval_hours"
        mandatory
        column
        selected-class="text-primary"
        :disabled="readonly || !draft.sync.auto_sync"
        data-test="sync-interval"
      >
        <v-chip
          v-for="interval in intervals"
          :key="interval.value"
          :value="interval.value"
          variant="tonal"
          filter
        >
          {{ interval.title }}
        </v-chip>
      </v-chip-group>
      <p class="text-body-small text-medium-emphasis mt-3 mb-0" data-test="sync-summary">
        <template v-if="draft.sync.auto_sync">
          {{ intervalLabel(draft.sync.interval_hours) }}, Cashcove fetches anything new from Plaid.
        </template>
        <template v-else>
          Automatic sync is off. You can still sync by hand from the Connect tab.
        </template>
      </p>
    </SettingsCard>

    <SettingsCard
      title="History for new connections"
      subtitle="How far back to import when you link a bank for the first time."
      :icon="History"
    >
      <v-select
        v-model="draft.sync.history_days"
        :items="history"
        label="Import transactions from"
        hide-details
        data-test="history-days"
        style="max-width: 360px"
      />
    </SettingsCard>

    <v-alert type="info" variant="tonal" :icon="CloudOff" class="mb-6" title="Why a schedule?">
      Plaid normally announces new transactions with webhooks, but a self-hosted Cashcove on your
      private network can't receive them from the internet. Scheduled syncing keeps your data fresh
      without opening your network to the outside.
    </v-alert>

    <SettingsCard
      title="Plaid"
      subtitle="The service Cashcove uses to link your banks."
      :icon="Plug"
    >
      <template #append>
        <v-chip
          v-if="plaid"
          :color="plaid.configured ? 'success' : 'warning'"
          variant="tonal"
          size="small"
          data-test="plaid-status"
        >
          {{ plaid.configured ? `Ready · ${plaid.environment}` : 'Not configured' }}
        </v-chip>
      </template>
      <p v-if="plaid && !plaid.configured" class="text-body-medium mb-4" data-test="plaid-setup">
        Add <code>CASHCOVE_PLAID_CLIENT_ID</code> and <code>CASHCOVE_PLAID_SECRET</code> to your
        <code>.env</code> file, then restart Cashcove.
      </p>
      <v-btn color="primary" variant="tonal" to="/connect" :prepend-icon="Plug">
        Go to Connect
      </v-btn>
    </SettingsCard>
  </PreferencesGate>
</template>
