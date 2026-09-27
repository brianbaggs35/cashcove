<script setup lang="ts">
import { computed } from 'vue'

import { useHousehold } from '@/composables/useHousehold'
import { fromIsoDate, toIsoDate } from '@/utils/dates'

/**
 * A day, typed in the household's date format or picked from a calendar. The model is an ISO
 * date, e.g. "2026-09-20", or null when empty.
 */
const model = defineModel<string | null>({ required: true })
const props = withDefaults(
  defineProps<{ label: string; min?: string; max?: string; required?: boolean }>(),
  { min: undefined, max: undefined, required: false },
)

const { locale } = useHousehold()

/** Typing follows the household's number format, e.g. mm/dd/yyyy in the US. */
const inputFormat = computed(() => {
  const parts = new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(2026, 11, 31))
  const order = parts
    .filter((part) => ['year', 'month', 'day'].includes(part.type))
    .map((part) => (part.type === 'year' ? 'yyyy' : part.type === 'month' ? 'mm' : 'dd'))
  const literal = parts.find((part) => part.type === 'literal')?.value ?? '/'
  const separator = ['/', '-', '.'].find((sign) => literal.includes(sign)) ?? '/'
  return order.join(separator)
})

const date = computed({
  get: () => (model.value ? fromIsoDate(model.value) : null),
  set: (value: Date | null) => {
    model.value = value ? toIsoDate(value) : null
  },
})

const rules = [(value: unknown) => !props.required || !!value || `Choose the ${props.label.toLowerCase()}`]
</script>

<template>
  <v-date-input
    v-model="date"
    :label="label"
    :input-format="inputFormat"
    :min="min"
    :max="max"
    :rules="rules"
    prepend-icon=""
    prepend-inner-icon="$calendar"
    variant="outlined"
    density="comfortable"
    autocomplete="off"
  />
</template>
