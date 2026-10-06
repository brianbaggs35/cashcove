<script setup lang="ts">
import { FileUp, Sparkles } from '@lucide/vue'

import { computed } from 'vue'

import type { AiReview } from '@/api/ai'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { useAiStore } from '@/stores/ai'
import { reviewActive, reviewStatusLabels, suggestionsOf } from '@/utils/ai'
import { formatCount } from '@/utils/format'

/**
 * Each time the AI looked over transactions: what started it, how it went and what it found.
 * Its suggestions can be listed by review.
 */
defineProps<{ reviews: AiReview[]; selected: string | null }>()
const emit = defineEmits<{ show: [review: AiReview] }>()

const ai = useAiStore()
/** Models by their ID, for naming the one a review used the way people know it. */
const names = computed(
  () =>
    new Map(
      ai.providers.flatMap((provider) => provider.models.map((model) => [model.id, model.name])),
    ),
)

function found(review: AiReview): string {
  const total = suggestionsOf(review)
  return total ? `${formatCount(total, 'suggestion')} found` : 'Nothing to suggest'
}
</script>

<template>
  <ul class="history pa-0 ma-0" data-test="review-history">
    <li
      v-for="review in reviews"
      :key="review.id"
      class="history__item d-flex flex-wrap align-center ga-3 py-3"
      data-test="review-history-item"
    >
      <v-avatar color="primary" variant="tonal" rounded="lg" size="40">
        <v-icon :icon="review.source === 'import' ? FileUp : Sparkles" size="20" />
      </v-avatar>
      <div class="flex-grow-1" style="min-width: 0">
        <div class="text-body-large font-weight-medium text-break" data-test="review-title">
          <template v-if="review.source === 'import'">
            Import{{ review.file_name ? ` of ${review.file_name}` : '' }}
          </template>
          <template v-else>Transactions you chose to review</template>
        </div>
        <div class="text-body-small text-medium-emphasis">
          <RelativeTime :value="review.created_at" />
          · {{ names.get(review.model) ?? review.model
          }}<template v-if="review.created_by"> · {{ review.created_by }}</template>
        </div>
        <div class="text-body-small mt-1" data-test="review-summary">
          <template v-if="review.status === 'done'">
            Looked at {{ formatCount(review.reviewed, 'transaction') }}. {{ found(review)
            }}<template v-if="suggestionsOf(review)"
              >: {{ review.open }} waiting, {{ review.applied }} applied,
              {{ review.dismissed }} dismissed</template
            >.
          </template>
          <template v-else-if="review.status === 'failed'">
            Stopped after {{ formatCount(review.reviewed, 'transaction') }} of
            {{ review.total.toLocaleString('en-US')
            }}<template v-if="review.error">: {{ review.error }}</template>
          </template>
          <template v-else> {{ reviewStatusLabels[review.status] }}… </template>
        </div>
      </div>
      <v-chip
        v-if="review.status !== 'done'"
        size="small"
        variant="tonal"
        :color="review.status === 'failed' ? 'warning' : 'primary'"
        data-test="review-status"
      >
        {{ reviewStatusLabels[review.status] }}
      </v-chip>
      <v-btn
        v-if="suggestionsOf(review)"
        variant="text"
        size="small"
        :color="selected === review.id ? 'primary' : undefined"
        :aria-pressed="selected === review.id"
        :aria-label="`Show the suggestions from this review`"
        data-test="review-show"
        :disabled="reviewActive(review.status) && !review.open"
        @click="emit('show', review)"
      >
        {{ selected === review.id ? 'Showing' : 'Show' }}
      </v-btn>
    </li>
  </ul>
</template>

<style scoped>
.history {
  list-style: none;
}

.history__item + .history__item {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
