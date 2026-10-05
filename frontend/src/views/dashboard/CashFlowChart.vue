<script setup lang="ts">
import { ChartColumn } from '@lucide/vue'
import { computed, shallowRef } from 'vue'
import { useDisplay } from 'vuetify'

import type { MonthFlow } from '@/api/dashboard'
import ChartFrame from '@/components/ui/ChartFrame.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { fromIsoDate } from '@/utils/dates'
import { toCents } from '@/utils/money'
import { compactMoney, niceTicks, tipShift } from '@/views/budget/chart'

/**
 * What came in and what was spent in each of the latest months, side by side. Two bar charts of
 * Vuetify's sparkline are laid over each other, each with its own bars in the gaps the other
 * leaves, so the months line up with the labels under them.
 */
const props = defineProps<{ months: MonthFlow[] }>()

const { money, currency, locale } = useHousehold()
const { xs } = useDisplay()

/** Each month is four slots wide: a gap, its income, its spending and a gap. */
const SLOTS = 4
const WIDTH = 480
const HEIGHT = 180
/** Space left between neighbouring bars, which are as wide as the rest of their slot. */
const GAP = 3

const slotWidth = computed(() => WIDTH / (props.months.length * SLOTS))
const dollars = (amount: string) => Math.max(0, toCents(amount) / 100)

const axis = computed(() =>
  niceTicks(
    Math.max(...props.months.flatMap((month) => [dollars(month.income), dollars(month.spent)])),
  ),
)
const ticks = computed(() =>
  axis.value.ticks.map((value) => ({
    value,
    label: compactMoney(value, currency.value, locale.value),
    height: `${(value / axis.value.max) * 100}%`,
  })),
)

/** One series laid out in the slots: its month's value in `place`, and nothing in the others. */
function series(place: number, pick: (month: MonthFlow) => string): number[] {
  return props.months.flatMap((month) =>
    Array.from({ length: SLOTS }, (_, slot) => (slot === place ? dollars(pick(month)) : 0)),
  )
}
/** The two charts, the second on top of the first. */
const layers = computed(() => [
  { name: 'income', color: 'var(--chart-income)', values: series(1, (month) => month.income) },
  { name: 'spent', color: 'var(--chart-spent)', values: series(2, (month) => month.spent) },
])
const hasData = computed(() => layers.value.some((layer) => layer.values.some(Boolean)))

const rows = computed(() =>
  props.months.map((month) => {
    const saved = toCents(month.income) - toCents(month.spent)
    const date = fromIsoDate(month.start)
    return {
      start: month.start,
      short: new Intl.DateTimeFormat(locale.value, { month: 'short' }).format(date),
      full: new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(date),
      income: money(month.income),
      spent: money(month.spent),
      saved: money(saved / 100, undefined, 'exceptZero'),
      leftOver: saved < 0 ? 'Overspent' : 'Saved',
    }
  }),
)

/** The month being pointed at or tabbed to, whose numbers show beside it. */
const active = shallowRef<(typeof rows.value)[number] | null>(null)
const tip = computed(() => {
  if (!active.value) return null
  const centre = (rows.value.indexOf(active.value) + 0.5) / rows.value.length
  return {
    row: active.value,
    style: { left: `${centre * 100}%`, transform: `translateX(${tipShift(centre, 1)})` },
  }
})
</script>

<template>
  <v-card data-test="cash-flow">
    <v-card-text class="pa-5">
      <ChartFrame
        title="Income and spending"
        description="Month by month, over the last six months."
        :rows="rows.length"
      >
        <template #legend>
          <span class="d-flex align-center ga-2 text-body-small">
            <span class="flow__key flow__key--income" aria-hidden="true" />Income
          </span>
          <span class="d-flex align-center ga-2 text-body-small">
            <span class="flow__key flow__key--spent" aria-hidden="true" />Spent
          </span>
        </template>

        <template #chart>
          <EmptyState
            v-if="!hasData"
            compact
            :icon="ChartColumn"
            title="Nothing to compare yet"
            text="Income and spending show up here once you have transactions."
          />
          <div
            v-else
            class="flow"
            :style="{ '--months': months.length }"
            data-test="cash-flow-chart"
          >
            <div class="flow__axis" aria-hidden="true">
              <span v-for="tick in ticks" :key="tick.value" :style="{ bottom: tick.height }">
                {{ tick.label }}
              </span>
            </div>
            <div class="flow__plot">
              <div class="flow__grid" aria-hidden="true">
                <span v-for="tick in ticks" :key="tick.value" :style="{ bottom: tick.height }" />
              </div>
              <div
                v-for="layer in layers"
                :key="layer.name"
                class="flow__layer"
                :class="`flow__layer--${layer.name}`"
                aria-hidden="true"
              >
                <v-sparkline
                  type="bar"
                  :model-value="layer.values"
                  :min="0"
                  :max="axis.max"
                  :width="WIDTH"
                  :height="HEIGHT"
                  :line-width="slotWidth - GAP"
                  :smooth="3"
                  :color="layer.color"
                />
              </div>
              <div class="flow__months">
                <button
                  v-for="row in rows"
                  :key="row.start"
                  type="button"
                  class="flow__month"
                  :aria-label="`${row.full}: income ${row.income}, spent ${row.spent}, ${row.leftOver.toLowerCase()} ${row.saved}`"
                  data-test="cash-flow-month"
                  @pointerenter="active = row"
                  @pointerleave="active = null"
                  @focus="active = row"
                  @blur="active = null"
                />
              </div>
              <div
                v-if="tip"
                class="flow__tip"
                :style="tip.style"
                aria-hidden="true"
                data-test="cash-flow-tip"
              >
                <p class="text-body-small text-medium-emphasis ma-0">{{ tip.row.full }}</p>
                <p class="d-flex align-center ga-2 ma-0">
                  <span class="flow__key flow__key--income" />
                  <strong class="tabular-nums">{{ tip.row.income }}</strong>
                  <span class="text-body-small text-medium-emphasis">income</span>
                </p>
                <p class="d-flex align-center ga-2 ma-0">
                  <span class="flow__key flow__key--spent" />
                  <strong class="tabular-nums">{{ tip.row.spent }}</strong>
                  <span class="text-body-small text-medium-emphasis">spent</span>
                </p>
                <p class="text-body-small ma-0 tabular-nums">
                  {{ tip.row.leftOver }} {{ tip.row.saved }}
                </p>
              </div>
            </div>
            <div class="flow__labels" aria-hidden="true">
              <span v-for="row in rows" :key="row.start">{{ row.short }}</span>
            </div>
          </div>
        </template>

        <template #table>
          <table data-test="cash-flow-table">
            <caption>
              What came in, what was spent and what was left over each month
            </caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th v-if="!xs" scope="col">Income</th>
                <th scope="col">Spent</th>
                <th scope="col">Left over</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.start" data-test="cash-flow-row">
                <th scope="row">
                  {{ row.full }}
                  <!-- A phone has no room for every column, so the month carries the income. -->
                  <span v-if="xs" class="flow__more" data-test="cash-flow-more">
                    Income {{ row.income }}
                  </span>
                </th>
                <td v-if="!xs">{{ row.income }}</td>
                <td>{{ row.spent }}</td>
                <td>{{ row.saved }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </ChartFrame>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.flow {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 6px 8px;
  max-width: 720px;
  margin-inline: auto;
}

.flow__axis {
  position: relative;
}

.flow__axis span {
  position: absolute;
  inset-inline: 0;
  transform: translateY(50%);
  font-size: 0.6875rem;
  line-height: 1;
  text-align: end;
  color: var(--chart-muted);
}

.flow__plot {
  position: relative;
}

.flow__grid span {
  position: absolute;
  inset-inline: 0;
  height: 1px;
  background: var(--chart-grid);
}

/* Vuetify's chart is an <svg> of its own, which only the wrapper's styles can reach. */
.flow__layer :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

/* The second chart sits exactly on the first, so its bars fill the gaps the first one leaves. */
.flow__layer--spent {
  position: absolute;
  inset: 0;
}

.flow__months {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(var(--months), 1fr);
}

.flow__month {
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: default;
}

.flow__month:hover,
.flow__month:focus-visible {
  background: var(--chart-grid);
  outline: none;
}

.flow__month:focus-visible {
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

.flow__tip {
  position: absolute;
  top: 0;
  z-index: 2;
  min-width: 170px;
  padding: 8px 12px;
  pointer-events: none;
  border: 1px solid var(--chart-grid);
  border-radius: 12px;
  background: var(--chart-surface);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
}

.flow__labels {
  grid-column: 2;
  display: grid;
  grid-template-columns: repeat(var(--months), 1fr);
  text-align: center;
  font-size: 0.75rem;
  color: var(--chart-muted);
}

.flow__more {
  display: block;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--chart-muted);
}

.flow__key {
  display: inline-block;
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.flow__key--income {
  background: var(--chart-income);
}

.flow__key--spent {
  background: var(--chart-spent);
}
</style>
