<script setup lang="ts">
import { computed } from 'vue'

import { useHousehold } from '@/composables/useHousehold'
import { toCents } from '@/utils/money'

/**
 * An amount of money in fixed-width digits. With `signed`, as for transactions, money coming in
 * reads green with a "+" and money going out with a "−".
 */
const props = withDefaults(
  defineProps<{
    amount: string
    /** The household's currency unless said otherwise. */
    currency?: string
    signed?: boolean
  }>(),
  { currency: undefined, signed: false },
)

const household = useHousehold()
const text = computed(() =>
  household.money(
    props.amount,
    props.currency ?? household.currency.value,
    props.signed ? 'exceptZero' : 'auto',
  ),
)
const incoming = computed(() => props.signed && toCents(props.amount) > 0)
</script>

<template>
  <span class="money tabular-nums text-no-wrap" :class="{ 'money--in': incoming }">
    {{ text }}
  </span>
</template>

<style scoped>
.money--in {
  color: rgb(var(--v-theme-success));
}
</style>
