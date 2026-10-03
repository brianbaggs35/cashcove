<script setup lang="ts">
import { computed } from 'vue'

import type { BudgetYear } from '@/api/budget'
import { formatMoney } from '@/utils/format'
import { toCents } from '@/utils/money'

const props = defineProps<{
  budgetYear: BudgetYear
  selectedMonth: string
}>()

const maximum = computed(() =>
  Math.max(
    0,
    ...props.budgetYear.months.flatMap((month) => [
      toCents(month.spending.budgeted),
      toCents(month.spending.actual),
    ]),
  ),
)

function barHeight(value: string): string {
  if (maximum.value <= 0) return '0%'
  const cents = Math.max(0, toCents(value))
  return `${Math.min(100, (cents / maximum.value) * 100)}%`
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00.000Z`),
  )
}
</script>

<template>
  <figure class="budget-chart" data-test="budget-year-chart">
    <figcaption class="budget-chart__caption">
      Monthly spending for budget year {{ budgetYear.year }}
    </figcaption>
    <div class="d-flex align-center ga-4 text-body-small text-medium-emphasis mb-4">
      <span class="d-flex align-center ga-2">
        <span class="budget-chart__legend budget-chart__legend--planned" />
        Budget set
      </span>
      <span class="d-flex align-center ga-2">
        <span class="budget-chart__legend budget-chart__legend--actual" />
        Spent
      </span>
    </div>
    <ul class="budget-chart__months" aria-label="Budget year months">
      <li
        v-for="month in budgetYear.months"
        :key="month.month"
        class="budget-chart__month"
        :class="{ 'budget-chart__month--selected': month.month === selectedMonth }"
        :aria-label="`${monthLabel(month.month)}: ${formatMoney(month.spending.actual, budgetYear.currency)} spent, ${formatMoney(month.spending.budgeted, budgetYear.currency)} budget set`"
        :data-test="`chart-month-${month.month}`"
      >
        <div class="budget-chart__bars">
          <span
            class="budget-chart__bar budget-chart__bar--planned"
            :style="{ height: barHeight(month.spending.budgeted) }"
            :title="`Budget set: ${formatMoney(month.spending.budgeted, budgetYear.currency)}`"
          />
          <span
            class="budget-chart__bar budget-chart__bar--actual"
            :style="{ height: barHeight(month.spending.actual) }"
            :title="`Spent: ${formatMoney(month.spending.actual, budgetYear.currency)}`"
          />
        </div>
        <span class="budget-chart__label text-caption">{{ monthLabel(month.month) }}</span>
      </li>
    </ul>
  </figure>
</template>

<style scoped>
.budget-chart {
  min-width: 0;
  margin: 0;
}

.budget-chart__caption {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.budget-chart__months {
  display: grid;
  grid-template-columns: repeat(12, minmax(32px, 1fr));
  gap: 6px;
  min-height: 166px;
  align-items: end;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-x: auto;
}

.budget-chart__month {
  display: flex;
  height: 158px;
  min-width: 32px;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  border-radius: 10px;
  padding: 6px 2px;
}

.budget-chart__month--selected {
  background: rgba(var(--v-theme-primary), 0.08);
}

.budget-chart__bars {
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 3px;
  width: 100%;
  height: 126px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.budget-chart__bar {
  display: block;
  width: min(34%, 13px);
  min-height: 0;
  border-radius: 5px 5px 2px 2px;
  transition: height 180ms ease;
}

.budget-chart__bar--planned {
  background: rgba(var(--v-theme-primary), 0.32);
}

.budget-chart__bar--actual {
  background: rgb(var(--v-theme-primary));
}

.budget-chart__legend {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.budget-chart__legend--planned {
  background: rgba(var(--v-theme-primary), 0.32);
}

.budget-chart__legend--actual {
  background: rgb(var(--v-theme-primary));
}

.budget-chart__label {
  color: rgb(var(--v-theme-on-surface-variant));
}

@media (prefers-reduced-motion: reduce) {
  .budget-chart__bar {
    transition: none;
  }
}
</style>
