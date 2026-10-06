<script setup lang="ts">
import { Plug, Sparkles, Tags, TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'

import { useConnectionAlerts } from '@/composables/useConnectionAlerts'
import { formatCount } from '@/utils/format'

/**
 * Things that need someone to look at them: banks that need attention, transactions with no
 * category, and what the AI suggested, which only shows once there's something waiting.
 */
const props = defineProps<{ uncategorized: number; aiRecommendations: number }>()

const alerts = useConnectionAlerts()

const aiWaiting = computed(() =>
  props.aiRecommendations === 1
    ? 'The AI has 1 suggestion for how your transactions are sorted.'
    : `The AI has ${formatCount(props.aiRecommendations, 'suggestion')} for how your transactions are sorted.`,
)

const needsCategory = computed(() =>
  props.uncategorized === 1
    ? '1 transaction has no category yet.'
    : `${formatCount(props.uncategorized, 'transaction')} have no category yet.`,
)
</script>

<template>
  <div
    v-if="alerts.count.value || uncategorized || aiRecommendations"
    class="d-grid ga-3 mb-6"
    data-test="attention"
  >
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
    <v-alert
      v-if="aiRecommendations"
      type="info"
      variant="tonal"
      density="compact"
      :icon="Sparkles"
      data-test="attention-ai"
    >
      {{ aiWaiting }}
      <template #append>
        <v-btn to="/ai/recommendations" variant="text" size="small" data-test="attention-ai-review">
          Look at them
        </v-btn>
      </template>
    </v-alert>
  </div>
</template>
