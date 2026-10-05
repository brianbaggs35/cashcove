<script setup lang="ts">
import { Plug, Tags, TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'

import { useConnectionAlerts } from '@/composables/useConnectionAlerts'
import { formatCount } from '@/utils/format'

/** Things that need someone to look at them: banks that need attention, and transactions with no category. */
const props = defineProps<{ uncategorized: number }>()

const alerts = useConnectionAlerts()

const needsCategory = computed(() =>
  props.uncategorized === 1
    ? '1 transaction has no category yet.'
    : `${formatCount(props.uncategorized, 'transaction')} have no category yet.`,
)
</script>

<template>
  <div v-if="alerts.count.value || uncategorized" class="d-grid ga-3 mb-6" data-test="attention">
    <v-alert
      v-if="alerts.count.value"
      type="warning"
      variant="tonal"
      density="compact"
      :icon="TriangleAlert"
      data-test="attention-banks"
    >
      {{ alerts.label.value }}.
      <template #append>
        <v-btn
          to="/connect"
          variant="text"
          size="small"
          :prepend-icon="Plug"
          data-test="attention-connect"
        >
          Fix it
        </v-btn>
      </template>
    </v-alert>
    <v-alert
      v-if="uncategorized"
      type="info"
      variant="tonal"
      density="compact"
      :icon="Tags"
      data-test="attention-uncategorized"
    >
      {{ needsCategory }}
      <template #append>
        <v-btn
          :to="{ path: '/transactions', query: { category: 'none' } }"
          variant="text"
          size="small"
          data-test="attention-review"
        >
          Review them
        </v-btn>
      </template>
    </v-alert>
  </div>
</template>
