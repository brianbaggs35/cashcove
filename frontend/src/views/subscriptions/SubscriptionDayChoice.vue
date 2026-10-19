<script setup lang="ts">
import { computed } from 'vue'

import DateField from '@/components/ui/DateField.vue'
import { useHousehold } from '@/composables/useHousehold'
import { formatListDate } from '@/utils/dates'
import { FIRST_DAY, LAST_DAY } from '@/views/subscriptions/recurrence'

/**
 * A day for a subscription or a bill, such as the day it ends or the day it is next due: typed or
 * picked in the date field, or chosen with one of two quick choices under it, today and a day the
 * dialog suggests, such as when it would next be paid.
 */
const day = defineModel<string | null>({ required: true })
const props = defineProps<{
  label: string
  hint: string
  today: string
  /** The day to suggest, or null when there is none worth offering beside today. */
  suggested: string | null
  /** What the suggested day is called, e.g. "Next payment". */
  suggestedName: string
  /** What the API said was wrong with the day. */
  error?: string
  /** What the test IDs of its parts start with, e.g. `subscription-cancel`. */
  part: string
}>()

const { locale } = useHousehold()

/** Which quick choice the day is, if it is one of them. Choosing the one that is chosen changes nothing. */
const quick = computed<'today' | 'suggested' | null>({
  get() {
    if (day.value === props.today) return 'today'
    return day.value !== null && day.value === props.suggested ? 'suggested' : null
  },
  set(choice) {
    if (choice === 'today') day.value = props.today
    else if (choice === 'suggested') day.value = props.suggested
  },
})
</script>

<template>
  <div>
    <DateField
      v-model="day"
      :label="label"
      required
      :min="FIRST_DAY"
      :max="LAST_DAY"
      :hint="hint"
      persistent-hint
      :error-messages="error"
      :data-test="`${part}-day`"
    />
    <v-btn-toggle
      v-model="quick"
      divided
      variant="outlined"
      color="primary"
      density="comfortable"
      class="mt-3"
      aria-label="Quick choices"
    >
      <v-btn value="today" :aria-pressed="quick === 'today'" :data-test="`${part}-today`">
        Today
      </v-btn>
      <v-btn
        v-if="suggested"
        value="suggested"
        :aria-pressed="quick === 'suggested'"
        :data-test="`${part}-suggested`"
      >
        {{ suggestedName }}, {{ formatListDate(suggested, locale) }}
      </v-btn>
    </v-btn-toggle>
  </div>
</template>
