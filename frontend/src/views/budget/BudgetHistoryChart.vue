<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import type { BudgetHistory, BudgetPeriodKind } from '@/api/budget'
import { useHousehold } from '@/composables/useHousehold'
import { toCents } from '@/utils/money'
import { columnPath, compactMoney, niceTicks, tipShift } from '@/views/budget/chart'
import ChartFrame from '@/views/budget/ChartFrame.vue'
import { periodLabel, shortPeriodLabel } from '@/views/budget/periods'

/**
 * What came in and what was spent in each of a budget's latest periods, with the amount it had
 * each time. Choosing a period looks at it.
 */
const props = defineProps<{
  history: BudgetHistory
  kind: BudgetPeriodKind
  /** The first day of the period being looked at. */
  selected: string
}>()
const emit = defineEmits<{ select: [start: string] }>()

const { money, currency, locale } = useHousehold()
const { xs } = useDisplay()

const HEIGHT = 240
const margin = { top: 16, right: 12, bottom: 28, left: 52 }
const width = computed(() => (xs.value ? 340 : 640))
const plot = computed(() => ({
  width: width.value - margin.left - margin.right,
  height: HEIGHT - margin.top - margin.bottom,
}))
const baseline = HEIGHT - margin.bottom

const dollars = (amount: string) => Math.max(0, toCents(amount) / 100)
const axis = computed(() =>
  niceTicks(
    Math.max(
      ...props.history.periods.flatMap((item) => [
        dollars(item.income),
        dollars(item.spent),
        dollars(item.amount),
      ]),
    ),
  ),
)
const y = (value: number) => margin.top + plot.value.height * (1 - value / axis.value.max)

const yTicks = computed(() =>
  axis.value.ticks.map((value) => ({
    value,
    y: y(value),
    label: compactMoney(value, currency.value, locale.value),
  })),
)

const groupWidth = computed(() => plot.value.width / props.history.periods.length)
const barWidth = computed(() => Math.max(3, Math.min(24, groupWidth.value / 2 - 3)))

const groups = computed(() =>
  props.history.periods.map((item, index) => {
    const left = margin.left + groupWidth.value * index
    const center = left + groupWidth.value / 2
    const reach = Math.min(groupWidth.value * 0.4, 30)
    const left_ = toCents(item.amount) - toCents(item.spent)
    return {
      item,
      index,
      left,
      center,
      selected: item.start === props.selected,
      label: shortPeriodLabel(props.kind, item.start, locale.value),
      full: periodLabel(props.kind, item.start, item.end, locale.value),
      income: columnPath(
        center - barWidth.value - 1,
        y(dollars(item.income)),
        barWidth.value,
        baseline,
      ),
      spent: columnPath(center + 1, y(dollars(item.spent)), barWidth.value, baseline),
      budget: { x1: center - reach, x2: center + reach, y: y(dollars(item.amount)) },
      result:
        left_ < 0
          ? `Over budget by ${money(-left_ / 100)}`
          : `Under budget by ${money(left_ / 100)}`,
      summary: `${periodLabel(props.kind, item.start, item.end, locale.value)}: income ${money(item.income)}, spent ${money(item.spent)}, budget ${money(item.amount)}`,
    }
  }),
)
/** Every other label, when there are too many to fit side by side. */
const crowded = computed(() => groupWidth.value < 34)

const active = ref<number | null>(null)
const tip = computed(() => {
  const group = active.value === null ? null : groups.value[active.value]
  if (!group) return null
  return {
    group,
    style: {
      left: `${(group.center / width.value) * 100}%`,
      transform: `translateX(${tipShift(group.center, width.value)})`,
    },
  }
})

function choose(start: string) {
  emit('select', start)
}
</script>

<template>
  <ChartFrame
    title="Income and spending, period by period"
    description="Each period's income and spending next to the amount the budget had. Choose one to look at it."
  >
    <template #legend>
      <span class="d-flex align-center ga-2 text-body-small">
        <span class="hist__key hist__key--income" aria-hidden="true" />Income
      </span>
      <span class="d-flex align-center ga-2 text-body-small">
        <span class="hist__key hist__key--spent" aria-hidden="true" />Spent
      </span>
      <span class="d-flex align-center ga-2 text-body-small">
        <span class="hist__key hist__key--budget" aria-hidden="true" />Budget
      </span>
    </template>

    <template #chart>
      <div class="hist" data-test="history-chart">
        <svg
          :viewBox="`0 0 ${width} ${HEIGHT}`"
          class="hist__svg"
          role="group"
          aria-label="Periods"
        >
          <g class="hist__grid" aria-hidden="true">
            <g v-for="tick in yTicks" :key="tick.value">
              <line :x1="margin.left" :x2="margin.left + plot.width" :y1="tick.y" :y2="tick.y" />
              <text :x="margin.left - 8" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
            </g>
          </g>
          <g v-for="group in groups" :key="group.item.start" data-test="history-group">
            <rect
              v-if="group.selected"
              :x="group.left + 2"
              :y="margin.top"
              :width="groupWidth - 4"
              :height="plot.height"
              rx="8"
              class="hist__selected"
            />
            <path v-if="group.income" :d="group.income" class="hist__bar hist__bar--income" />
            <path v-if="group.spent" :d="group.spent" class="hist__bar hist__bar--spent" />
            <line
              :x1="group.budget.x1"
              :x2="group.budget.x2"
              :y1="group.budget.y"
              :y2="group.budget.y"
              class="hist__budget"
            />
            <text
              v-if="!crowded || group.index % 2 === 0"
              :x="group.center"
              :y="HEIGHT - 8"
              text-anchor="middle"
              class="hist__label"
              :class="{ 'hist__label--selected': group.selected }"
              aria-hidden="true"
            >
              {{ group.label }}
            </text>
            <rect
              :x="group.left"
              :y="margin.top"
              :width="groupWidth"
              :height="plot.height + margin.bottom"
              class="hist__hit"
              tabindex="0"
              role="button"
              :aria-label="group.summary"
              :aria-current="group.selected ? 'true' : undefined"
              data-test="history-period"
              @click="choose(group.item.start)"
              @keydown.enter.prevent="choose(group.item.start)"
              @keydown.space.prevent="choose(group.item.start)"
              @pointerenter="active = group.index"
              @pointerleave="active = null"
              @focus="active = group.index"
              @blur="active = null"
            />
          </g>
        </svg>
        <div
          v-if="tip"
          class="hist__tip"
          :style="tip.style"
          aria-hidden="true"
          data-test="history-tip"
        >
          <p class="text-body-small text-medium-emphasis ma-0">{{ tip.group.full }}</p>
          <p class="d-flex align-center ga-2 ma-0">
            <span class="hist__key hist__key--income" />
            <strong class="tabular-nums">{{ money(tip.group.item.income) }}</strong>
            <span class="text-body-small text-medium-emphasis">income</span>
          </p>
          <p class="d-flex align-center ga-2 ma-0">
            <span class="hist__key hist__key--spent" />
            <strong class="tabular-nums">{{ money(tip.group.item.spent) }}</strong>
            <span class="text-body-small text-medium-emphasis">spent</span>
          </p>
          <p class="text-body-small ma-0 tabular-nums">
            Budget {{ money(tip.group.item.amount) }} · {{ tip.group.result }}
          </p>
        </div>
      </div>
    </template>

    <template #table>
      <table data-test="history-table">
        <caption>
          Each period's income, spending and budget
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Income</th>
            <th scope="col">Spent</th>
            <th scope="col">Budget</th>
            <th scope="col">Left</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="group in groups" :key="group.item.start" data-test="history-row">
            <th scope="row">{{ group.full }}</th>
            <td>{{ money(group.item.income) }}</td>
            <td>{{ money(group.item.spent) }}</td>
            <td>{{ money(group.item.amount) }}</td>
            <td>
              {{
                money(
                  (toCents(group.item.amount) - toCents(group.item.spent)) / 100,
                  undefined,
                  'exceptZero',
                )
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </ChartFrame>
</template>

<style scoped>
.hist {
  position: relative;
}

.hist__svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.hist__grid line {
  stroke: var(--chart-grid);
  stroke-width: 1;
}

.hist__grid text,
.hist__label {
  fill: var(--chart-muted);
  font-size: 11px;
}

.hist__label--selected {
  fill: var(--chart-ink);
  font-weight: 700;
}

.hist__selected {
  fill: var(--chart-grid);
  fill-opacity: 0.5;
}

.hist__bar--income {
  fill: var(--chart-income);
}

.hist__bar--spent {
  fill: var(--chart-spent);
}

.hist__budget {
  stroke: var(--chart-ink);
  stroke-width: 2;
  stroke-linecap: round;
}

.hist__hit {
  fill: transparent;
  cursor: pointer;
  outline: none;
}

.hist__hit:hover {
  fill: var(--chart-grid);
  fill-opacity: 0.25;
}

.hist__hit:focus-visible {
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 3;
  rx: 8;
}

.hist__key {
  display: inline-block;
  flex-shrink: 0;
}

.hist__key--income,
.hist__key--spent {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.hist__key--income {
  background: var(--chart-income);
}

.hist__key--spent {
  background: var(--chart-spent);
}

.hist__key--budget {
  width: 16px;
  border-top: 2px solid var(--chart-ink);
}

.hist__tip {
  position: absolute;
  top: 0;
  z-index: 2;
  min-width: 190px;
  padding: 8px 12px;
  pointer-events: none;
  border: 1px solid var(--chart-grid);
  border-radius: 12px;
  background: var(--chart-surface);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
}
</style>
