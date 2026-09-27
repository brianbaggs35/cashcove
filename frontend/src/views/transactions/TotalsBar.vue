<script setup lang="ts">
import { computed } from 'vue'

import type { TransactionTotals } from '@/api/transactions'
import { useHousehold } from '@/composables/useHousehold'
import { fromCents, toCents } from '@/utils/money'

/** What everything that matches adds up to, in each currency, the household's own first. */
const props = defineProps<{ totals: TransactionTotals[]; total: number }>()

const { currency, money } = useHousehold()

const rows = computed(() =>
  [...props.totals]
    .sort(
      (a, b) =>
        Number(b.currency === currency.value) - Number(a.currency === currency.value) ||
        a.currency.localeCompare(b.currency),
    )
    .map((totals) => ({
      ...totals,
      net: fromCents(toCents(totals.money_in) + toCents(totals.money_out)),
    })),
)
</script>

<template>
  <div class="totals d-flex flex-wrap ga-3 mb-4" data-test="transaction-totals">
    <div class="totals__tile">
      <div class="text-label-medium text-medium-emphasis">Transactions</div>
      <div class="text-title-medium font-weight-bold tabular-nums" data-test="totals-count">
        {{ total.toLocaleString() }}
      </div>
    </div>
    <template v-for="row in rows" :key="row.currency">
      <div class="totals__tile">
        <div class="text-label-medium text-medium-emphasis">
          Money in<template v-if="rows.length > 1"> ({{ row.currency }})</template>
        </div>
        <div
          class="text-title-medium font-weight-bold tabular-nums totals__in"
          data-test="totals-in"
        >
          {{ money(row.money_in, row.currency, 'exceptZero') }}
        </div>
      </div>
      <div class="totals__tile">
        <div class="text-label-medium text-medium-emphasis">
          Money out<template v-if="rows.length > 1"> ({{ row.currency }})</template>
        </div>
        <div class="text-title-medium font-weight-bold tabular-nums" data-test="totals-out">
          {{ money(row.money_out, row.currency) }}
        </div>
      </div>
      <div class="totals__tile">
        <div class="text-label-medium text-medium-emphasis">
          Net<template v-if="rows.length > 1"> ({{ row.currency }})</template>
        </div>
        <div class="text-title-medium font-weight-bold tabular-nums" data-test="totals-net">
          {{ money(row.net, row.currency, 'exceptZero') }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.totals__tile {
  flex: 1 1 140px;
  padding: 12px 16px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.totals__in {
  color: rgb(var(--v-theme-success));
}
</style>
