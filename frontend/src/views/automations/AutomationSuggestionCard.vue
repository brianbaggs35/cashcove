<script setup lang="ts">
import { Check, TriangleAlert, WandSparkles } from '@lucide/vue'
import { computed } from 'vue'

import type { AutomationSuggestion } from '@/api/ai'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import { useHousehold } from '@/composables/useHousehold'
import { formatListDate } from '@/utils/dates'
import { formatCount } from '@/utils/format'
import { directionPhrases, matchPhrases } from '@/views/automations/looks'

/**
 * An automation the AI suggests: what it would look for and give, the choices it comes from and
 * what it would do now, so it can be judged at a glance. Making it opens the form for a new
 * automation, with all of this filled in, to check and change.
 */
const props = defineProps<{ suggestion: AutomationSuggestion; created: boolean }>()
const emit = defineEmits<{ create: []; skip: [] }>()

const { locale } = useHousehold()

/** What it looks for, as a sentence. */
const looksFor = computed(() => {
  const texts = props.suggestion.payees.map((payee) => `“${payee}”`).join(', ')
  const start = `${matchPhrases[props.suggestion.match]} ${texts}`
  const way = directionPhrases[props.suggestion.direction]
  return way ? `${start}, ${way}` : start
})

const chosen = computed(
  () =>
    `Chosen ${formatCount(props.suggestion.choices, 'time')}, the last on ${formatListDate(props.suggestion.last_chosen, locale.value)}`,
)

/** What it would sort now, which only counts what has no category. */
const sorts = computed(() => {
  const count = props.suggestion.sorts_now
  if (!count) return 'Nothing is waiting to be sorted, but it would sort what comes next'
  return `Would sort ${formatCount(count, 'transaction')} with no category now`
})

const elsewhere = computed(() => {
  const count = props.suggestion.elsewhere
  return `${formatCount(count, 'other transaction')} you put in another category would stay as you chose`
})

/** The automations that already give some of the same transactions a category, which go first. */
const overlapping = computed(() => {
  const names = props.suggestion.overlaps.map((overlap) => overlap.automation_name)
  if (names.length === 1) return `${names[0]} already sorts some of these, and goes first.`
  return `${names.join(' and ')} already sort some of these, and go first.`
})
</script>

<template>
  <v-sheet border rounded="lg" class="pa-4" data-test="automation-suggestion">
    <div class="d-flex align-start ga-3">
      <v-avatar color="primary" variant="tonal" rounded="lg" size="44" class="flex-shrink-0">
        <v-icon :icon="WandSparkles" size="22" />
      </v-avatar>
      <div class="flex-grow-1" style="min-width: 0">
        <h3 class="text-title-small font-weight-bold ma-0 text-break" data-test="suggestion-name">
          {{ suggestion.name }}
        </h3>
        <div class="mt-1" data-test="suggestion-rule">
          <p class="text-body-medium mb-1">{{ looksFor }}</p>
          <p class="d-flex align-center flex-wrap ga-2 text-body-small text-medium-emphasis mb-0">
            Puts them in
            <CategoryChip :category-id="suggestion.category_id" />
          </p>
        </div>
      </div>
    </div>

    <ul
      class="suggestion-evidence text-body-small text-medium-emphasis mt-3"
      data-test="suggestion-evidence"
    >
      <li>{{ chosen }}</li>
      <li>{{ sorts }}</li>
      <li v-if="suggestion.elsewhere" data-test="suggestion-elsewhere">{{ elsewhere }}</li>
    </ul>

    <p
      v-if="suggestion.reason"
      class="text-body-small text-medium-emphasis mt-2 mb-0"
      data-test="suggestion-reason"
    >
      {{ suggestion.reason }}
    </p>

    <v-alert
      v-if="suggestion.overlaps.length"
      :icon="TriangleAlert"
      type="warning"
      variant="tonal"
      density="compact"
      class="mt-3"
      data-test="suggestion-overlap"
    >
      {{ overlapping }}
    </v-alert>

    <div class="d-flex align-center ga-2 mt-4">
      <v-chip
        v-if="created"
        color="success"
        variant="tonal"
        :prepend-icon="Check"
        data-test="suggestion-created"
      >
        Created
      </v-chip>
      <template v-else>
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="WandSparkles"
          data-test="suggestion-create"
          @click="emit('create')"
        >
          Review and create
        </v-btn>
        <v-btn variant="text" data-test="suggestion-skip" @click="emit('skip')">Skip</v-btn>
      </template>
    </div>
  </v-sheet>
</template>

<style scoped>
.suggestion-evidence {
  padding-inline-start: 18px;
}
</style>
