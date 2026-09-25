<script setup lang="ts">
import { Activity, Database, Plug, RefreshCw, Server, Tag } from '@lucide/vue'
import { computed } from 'vue'

import { useHealthStore } from '@/stores/health'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const store = useHealthStore()

const rows = computed(() => {
  const { health, system } = store
  if (!health || !system) return []
  return [
    {
      key: 'api',
      title: 'API',
      icon: Server,
      value: health.status === 'ok' ? 'Healthy' : 'Degraded',
      color: health.status === 'ok' ? 'success' : 'warning',
    },
    {
      key: 'database',
      title: 'Database',
      icon: Database,
      value: health.database === 'ok' ? 'Connected' : 'Unavailable',
      color: health.database === 'ok' ? 'success' : 'error',
    },
    {
      key: 'plaid',
      title: 'Plaid',
      icon: Plug,
      value: system.plaid.configured
        ? `Configured · ${system.plaid.environment}`
        : 'Not configured',
      color: system.plaid.configured ? 'success' : 'warning',
    },
    { key: 'version', title: 'Version', icon: Tag, value: system.version, color: undefined },
    {
      key: 'environment',
      title: 'Environment',
      icon: Activity,
      value: system.environment,
      color: undefined,
    },
  ]
})
</script>

<template>
  <SettingsCard
    title="System status"
    subtitle="Live checks against this Cashcove install."
    :icon="Activity"
  >
    <template #append>
      <v-btn
        :icon="RefreshCw"
        variant="text"
        size="small"
        aria-label="Refresh status"
        :loading="store.loading"
        data-test="refresh-health"
        @click="store.refresh()"
      />
    </template>
    <v-alert
      v-if="store.error"
      type="error"
      variant="tonal"
      title="Can't reach the Cashcove API"
      :text="store.error"
      data-test="health-error"
    />
    <v-list v-else-if="rows.length" bg-color="transparent" class="pa-0">
      <v-list-item
        v-for="row in rows"
        :key="row.key"
        :title="row.title"
        class="px-0"
        :data-test="`health-${row.key}`"
      >
        <template #prepend>
          <v-icon :icon="row.icon" size="20" class="me-n2" />
        </template>
        <template #append>
          <v-chip v-if="row.color" :color="row.color" size="small" variant="tonal">
            {{ row.value }}
          </v-chip>
          <span v-else class="text-body-medium text-medium-emphasis">{{ row.value }}</span>
        </template>
      </v-list-item>
    </v-list>
    <v-skeleton-loader v-else type="list-item@4" data-test="health-loading" />
  </SettingsCard>
</template>
