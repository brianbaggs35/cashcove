<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useHousehold } from '@/composables/useHousehold'
import { currencySymbol } from '@/utils/format'
import { amountForInput, parseAmount, toCents } from '@/utils/money'

/**
 * An amount of money, typed in the household's number format. The model is the API's form,
 * e.g. "1234.50", or null while the field is empty or what's typed isn't an amount; the
 * field's rules say which, so forms check they're valid before using it.
 */
const model = defineModel<string | null>({ required: true })
const props = withDefaults(
  defineProps<{
    label: string
    /** The household's currency unless said otherwise. */
    currency?: string
    required?: boolean
    /** Accepts a minus sign, e.g. for an overdrawn balance. */
    allowNegative?: boolean
    nonZero?: boolean
  }>(),
  { currency: undefined, required: false, allowNegative: false, nonZero: false },
)

const household = useHousehold()
const symbol = computed(() =>
  currencySymbol(props.currency ?? household.currency.value, household.locale.value),
)
const example = computed(() => amountForInput('42.5', household.locale.value))

const display = (value: string | null) =>
  value === null ? '' : amountForInput(value, household.locale.value)
const text = ref(display(model.value))
const parse = (value: string) => parseAmount(value, household.locale.value)

// A new amount from outside, e.g. a form being reset, replaces what's typed.
watch(model, (value) => {
  if (value !== parse(text.value)) text.value = display(value)
})

function typed(value: string) {
  text.value = value
  model.value = parse(value)
}

/** Once someone moves on, the amount reads the way Cashcove shows amounts, e.g. 42.50. */
function tidy() {
  if (model.value !== null) text.value = display(model.value)
}

function check(value: string): true | string {
  const text = value.trim()
  if (!text) return !props.required || `Enter the ${props.label.toLowerCase()}`
  const amount = parse(text)
  if (amount === null) return `Enter an amount like ${example.value}`
  if (!props.allowNegative && toCents(amount) < 0) return 'Enter the amount without a minus sign'
  if (props.nonZero && toCents(amount) === 0) return 'Enter an amount other than zero'
  return true
}

const rules = [check]
</script>

<template>
  <v-text-field
    :model-value="text"
    :label="label"
    :prefix="symbol"
    :rules="rules"
    inputmode="decimal"
    autocomplete="off"
    class="money-field"
    @update:model-value="typed"
    @blur="tidy"
  />
</template>

<style scoped>
.money-field :deep(input) {
  font-variant-numeric: tabular-nums;
}
</style>
