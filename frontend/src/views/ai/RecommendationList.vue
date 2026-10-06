<script setup lang="ts">
import { ArrowRight, Check, X } from '@lucide/vue'

import type { AiRecommendation } from '@/api/ai'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { confidenceColors, confidenceLabels } from '@/utils/ai'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'

/**
 * What the AI suggested, a card to each: the transaction, the category it has and the one the AI
 * would give it, and why. Admins can tick several, or apply or turn down one.
 */
defineProps<{
  items: AiRecommendation[]
  /** Admins decide; everyone else just sees. */
  canDecide: boolean
  busy?: boolean
}>()
const emit = defineEmits<{ apply: [ids: string[]]; dismiss: [ids: string[]] }>()
const selected = defineModel<string[]>({ default: () => [] })

const { locale } = useHousehold()
</script>

<template>
  <ul class="reco-list pa-0 ma-0" data-test="recommendation-list">
    <li
      v-for="item in items"
      :key="item.id"
      class="reco d-flex flex-column flex-sm-row align-sm-center ga-3 pa-4"
      :class="{ 'reco--decided': item.status !== 'open' }"
      data-test="recommendation"
    >
      <div class="d-flex align-start ga-2 flex-grow-1" style="min-width: 0">
        <v-checkbox-btn
          v-if="canDecide && item.status === 'open'"
          v-model="selected"
          :value="item.id"
          density="comfortable"
          class="reco__check"
          :aria-label="`Select ${item.payee}`"
          data-test="recommendation-select"
        />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="d-flex flex-wrap align-baseline gc-3 gr-1">
            <span class="text-title-small font-weight-bold text-break" data-test="reco-payee">
              {{ item.payee }}
            </span>
            <MoneyAmount :amount="item.amount" :currency="item.currency" signed />
            <span class="text-body-small text-medium-emphasis">
              {{ formatShortDate(fromIsoDate(item.date), locale) }}
            </span>
          </div>
          <div class="d-flex flex-wrap align-center ga-2 mt-2">
            <span class="d-sr-only">Now filed under</span>
            <CategoryChip :category-id="item.current_category_id" />
            <v-icon :icon="ArrowRight" size="16" aria-hidden="true" class="text-medium-emphasis" />
            <span class="d-sr-only">The AI suggests</span>
            <CategoryChip :category-id="item.suggested_category_id" />
            <v-chip
              size="x-small"
              variant="tonal"
              :color="confidenceColors[item.confidence]"
              data-test="reco-confidence"
            >
              {{ confidenceLabels[item.confidence] }}
            </v-chip>
          </div>
          <p class="text-body-small text-medium-emphasis mt-2 mb-0" data-test="reco-reason">
            {{ item.reason }}
          </p>
        </div>
      </div>

      <div v-if="item.status !== 'open'" class="flex-shrink-0">
        <v-chip
          size="small"
          variant="tonal"
          :color="item.status === 'applied' ? 'success' : undefined"
          data-test="reco-status"
        >
          {{ item.status === 'applied' ? 'Applied' : 'Dismissed' }}
        </v-chip>
      </div>
      <div v-else-if="canDecide" class="reco__actions d-flex ga-2 flex-shrink-0">
        <v-btn
          size="small"
          variant="tonal"
          color="primary"
          :prepend-icon="Check"
          :disabled="busy"
          :aria-label="`Apply the suggestion for ${item.payee}`"
          data-test="reco-apply"
          @click="emit('apply', [item.id])"
        >
          Apply
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="X"
          :disabled="busy"
          :aria-label="`Dismiss the suggestion for ${item.payee}`"
          data-test="reco-dismiss"
          @click="emit('dismiss', [item.id])"
        >
          Dismiss
        </v-btn>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.reco-list {
  list-style: none;
}

.reco {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.reco:last-child {
  border-bottom: 0;
}

.reco--decided {
  opacity: 0.8;
}

.reco__check {
  flex: none;
  margin: -6px 0 0 -10px;
}

@media (max-width: 599px) {
  .reco__actions > .v-btn {
    flex: 1 1 0;
  }
}
</style>
