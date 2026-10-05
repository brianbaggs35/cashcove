<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import type { BudgetPeriodView } from '@/api/budget'
import { useHousehold } from '@/composables/useHousehold'
import { addDays, fromIsoDate } from '@/utils/dates'
import { toCents } from '@/utils/money'
import {
  compactMoney,
  linePath,
  nearestIndex,
  niceTicks,
  runningTotal,
  tipShift,
} from '@/views/budget/chart'
import ChartFrame from '@/views/budget/ChartFrame.vue'

/**
 * How spending builds up over a period against the amount, day by day, with the straight line an
 * even pace would follow. Point at a day, or move between days with the arrow keys, to read it.
 */
const props = defineProps<{ period: BudgetPeriodView }>()

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

/** The last day with spending to show: none before the period starts, all of them once it's over. */
const through = computed(() => props.period.days_gone - 1)
const totals = computed(() => runningTotal(props.period.daily, props.period.start, through.value))
const amount = computed(() => Number(props.period.amount))
const axis = computed(() => niceTicks(Math.max(amount.value, ...totals.value)))

const x = (index: number) =>
  margin.left + (props.period.days > 1 ? index / (props.period.days - 1) : 0.5) * plot.value.width
const y = (value: number) => margin.top + plot.value.height * (1 - value / axis.value.max)

const dayText = (index: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale.value, options).format(
    fromIsoDate(addDays(props.period.start, index)),
  )
const shortDay = (index: number) => dayText(index, { month: 'short', day: 'numeric' })

const yTicks = computed(() =>
  axis.value.ticks.map((value) => ({
    value,
    y: y(value),
    label: compactMoney(value, currency.value, locale.value),
  })),
)
/** Which way a label on the time axis reads from its tick: the first one inward, the last one back. */
function tickAnchor(index: number, last: number): string {
  if (index === 0) return 'start'
  return index === last ? 'end' : 'middle'
}
const xTicks = computed(() => {
  const last = props.period.days - 1
  return [...new Set([0, Math.round(last / 3), Math.round((2 * last) / 3), last])].map((index) => ({
    index,
    x: x(index),
    label: shortDay(index),
    anchor: tickAnchor(index, last),
  }))
})

interface Point {
  x: number
  y: number
  /** What had been spent by the end of the day. */
  value: number
}

const points = computed<Point[]>(() =>
  totals.value.map((value, index) => ({ x: x(index), y: y(value), value })),
)
const line = computed(() => linePath(points.value.map((point) => [point.x, point.y] as const)))
const area = computed(() => {
  const first = points.value[0]
  const last = points.value.at(-1)
  return first && last && points.value.length > 1
    ? `${line.value} L${last.x.toFixed(1)} ${baseline} L${first.x.toFixed(1)} ${baseline} Z`
    : ''
})
const pace = computed(() =>
  linePath([
    [x(0), y(amount.value / props.period.days)],
    [x(props.period.days - 1), y(amount.value)],
  ]),
)
const budgetY = computed(() => y(amount.value))

/**
 * Where spending ends up, which says so beside it. Late in the period the label sits left of the
 * dot and above it, clear of the line that climbs to it, unless the budget line or the top edge is
 * there. Early on it sits right of the dot, over the days still to come.
 */
const end = computed(() => {
  const last = points.value.at(-1)
  if (!last) return null
  const left = last.x > margin.left + plot.value.width * 0.6
  const clear = last.y > 24 && Math.abs(last.y - budgetY.value - 4) >= 14
  const above = left ? clear : last.y >= baseline - 28
  return {
    x: last.x,
    y: last.y,
    anchor: left ? 'end' : 'start',
    labelX: left ? last.x - 8 : last.x + 8,
    labelY: above ? last.y - 10 : last.y + 18,
    text: `Spent ${money(last.value)}`,
  }
})

// Reading a day.
const focus = ref<number | null>(null)

/** What to read for a day with spending to show: where it is on the chart, and what it says. */
function read(index: number) {
  const point = points.value[index] as Point
  const before = index > 0 ? (points.value[index - 1] as Point).value : 0
  const left = amount.value - point.value
  return {
    index,
    x: point.x,
    y: point.y,
    date: dayText(index, { weekday: 'long', month: 'long', day: 'numeric' }),
    total: money(point.value),
    day: money(point.value - before),
    left: left < 0 ? `Over by ${money(-left)}` : `${money(left)} left`,
    // Beside the day, held on the chart near either edge.
    tip: {
      left: `${(point.x / width.value) * 100}%`,
      transform: `translateX(${tipShift(point.x, width.value)})`,
    },
  }
}
const reading = computed(() => (focus.value === null ? null : read(focus.value)))
/** What the scrubber says of the day it is on, which is the latest one until another is read. */
const valueText = computed(() => {
  const day = read(focus.value ?? through.value)
  return `${day.date}: ${day.total} spent so far, ${day.day} that day, ${day.left}.`
})

function point(event: PointerEvent) {
  if (through.value < 0) return
  const rect = (event.currentTarget as Element).getBoundingClientRect()
  const position =
    (((event.clientX - rect.left) / (rect.width || width.value)) * width.value - margin.left) /
    plot.value.width
  focus.value = Math.min(through.value, nearestIndex(position, props.period.days))
}

/** The scrubber has the keyboard: start reading from the latest day. */
function arrive() {
  focus.value ??= through.value
}

/** The scrubber moved to another day: the arrow keys, Home and End are the browser's to handle. */
function scrub(event: Event) {
  focus.value = Number((event.target as HTMLInputElement).value)
}

/** What was spent on each day it happened, and the total so far, for reading without the picture. */
const rows = computed(() => {
  let cents = 0
  return props.period.daily
    .filter((item) => toCents(item.spent) !== 0)
    .map((item) => {
      cents += toCents(item.spent)
      return {
        day: item.day,
        label: new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
          fromIsoDate(item.day),
        ),
        spent: money(item.spent),
        total: money(cents / 100),
      }
    })
})
</script>

<template>
  <ChartFrame
    title="Spending through the period"
    description="Against the budget, and the even pace that would use it up exactly as the period ends."
    :rows="rows.length"
  >
    <template #legend>
      <span class="d-flex align-center ga-2 text-body-small">
        <span class="pace__key pace__key--spent" aria-hidden="true" />Spent
      </span>
      <span class="d-flex align-center ga-2 text-body-small">
        <span class="pace__key pace__key--budget" aria-hidden="true" />Budget
      </span>
      <span class="d-flex align-center ga-2 text-body-small">
        <span class="pace__key pace__key--pace" aria-hidden="true" />Even pace
      </span>
    </template>

    <template #chart>
      <div class="pace" data-test="pace-chart">
        <!-- Out of sight, and the keyboard's way to read the days one by one. -->
        <input
          v-if="through >= 0"
          type="range"
          class="pace__scrub"
          min="0"
          :max="through"
          step="1"
          :value="focus ?? through"
          aria-label="Spending through the period, day by day"
          :aria-valuetext="valueText"
          data-test="pace-scrub"
          @focus="arrive"
          @blur="focus = null"
          @input="scrub"
          @keydown.esc="focus = null"
        />
        <svg
          :viewBox="`0 0 ${width} ${HEIGHT}`"
          class="pace__svg"
          aria-hidden="true"
          @pointermove="point"
          @pointerleave="focus = null"
        >
          <g class="pace__grid">
            <g v-for="tick in yTicks" :key="tick.value">
              <line :x1="margin.left" :x2="margin.left + plot.width" :y1="tick.y" :y2="tick.y" />
              <text :x="margin.left - 8" :y="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
            </g>
          </g>
          <g class="pace__axis">
            <text
              v-for="tick in xTicks"
              :key="tick.index"
              :x="tick.x"
              :y="HEIGHT - 8"
              :text-anchor="tick.anchor"
            >
              {{ tick.label }}
            </text>
          </g>
          <path :d="pace" class="pace__even" />
          <line
            :x1="margin.left"
            :x2="margin.left + plot.width"
            :y1="budgetY"
            :y2="budgetY"
            class="pace__budget"
          />
          <text
            :x="margin.left + plot.width"
            :y="budgetY - 6"
            text-anchor="end"
            class="pace__label"
            data-test="pace-budget-label"
          >
            Budget {{ money(amount) }}
          </text>
          <path v-if="area" :d="area" class="pace__area" />
          <path v-if="line" :d="line" class="pace__line" />
          <template v-if="end">
            <circle :cx="end.x" :cy="end.y" r="4" class="pace__dot" />
            <text
              :x="end.labelX"
              :y="end.labelY"
              :text-anchor="end.anchor"
              class="pace__label"
              data-test="pace-end-label"
            >
              {{ end.text }}
            </text>
          </template>
          <template v-if="reading">
            <line
              :x1="reading.x"
              :x2="reading.x"
              :y1="margin.top"
              :y2="baseline"
              class="pace__cursor"
            />
            <circle :cx="reading.x" :cy="reading.y" r="4.5" class="pace__dot" />
          </template>
        </svg>
        <div
          v-if="reading"
          class="pace__tip"
          :style="reading.tip"
          aria-hidden="true"
          data-test="pace-tip"
        >
          <p class="text-body-small text-medium-emphasis ma-0">{{ reading.date }}</p>
          <p class="d-flex align-center ga-2 ma-0">
            <span class="pace__key pace__key--spent" />
            <strong class="tabular-nums">{{ reading.total }}</strong>
            <span class="text-body-small text-medium-emphasis">spent so far</span>
          </p>
          <p class="text-body-small ma-0 tabular-nums">
            {{ reading.day }} that day · {{ reading.left }}
          </p>
        </div>
      </div>
    </template>

    <template #table="{ limit }">
      <table data-test="pace-table">
        <caption>
          Spending on the days it happened
        </caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Spent</th>
            <th scope="col">Spent so far</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows.slice(0, limit)" :key="row.day" data-test="pace-row">
            <th scope="row">{{ row.label }}</th>
            <td>{{ row.spent }}</td>
            <td>{{ row.total }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="3">Nothing has been spent yet.</td>
          </tr>
        </tbody>
      </table>
    </template>
  </ChartFrame>
</template>

<style scoped>
.pace {
  position: relative;
  border-radius: 12px;
}

/* The scrubber is out of sight, so the chart itself shows when the keyboard is on it. */
.pace:has(.pace__scrub:focus-visible) {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.55);
}

.pace__svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  touch-action: pan-y;
}

.pace__grid line {
  stroke: var(--chart-grid);
  stroke-width: 1;
}

.pace__grid text,
.pace__axis text {
  fill: var(--chart-muted);
  font-size: 11px;
}

/* A halo in the surface colour keeps a label readable where a line passes behind it. */
.pace__label {
  fill: var(--chart-ink);
  font-size: 12px;
  font-weight: 600;
  paint-order: stroke;
  stroke: var(--chart-surface);
  stroke-width: 4px;
  stroke-linejoin: round;
}

.pace__line {
  fill: none;
  stroke: var(--chart-spent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pace__area {
  fill: var(--chart-spent);
  fill-opacity: 0.1;
}

.pace__budget {
  stroke: var(--chart-ink);
  stroke-width: 2;
}

.pace__even {
  fill: none;
  stroke: var(--chart-muted);
  stroke-width: 1.5;
}

.pace__dot {
  fill: var(--chart-spent);
  stroke: var(--chart-surface);
  stroke-width: 2;
}

.pace__cursor {
  stroke: var(--chart-muted);
  stroke-width: 1;
}

.pace__key {
  display: inline-block;
  width: 16px;
  height: 0;
  border-top: 3px solid;
  border-radius: 2px;
  flex-shrink: 0;
}

.pace__key--spent {
  border-color: var(--chart-spent);
}

.pace__key--budget {
  border-color: var(--chart-ink);
}

.pace__key--pace {
  border-color: var(--chart-muted);
  border-top-width: 2px;
}

.pace__tip {
  position: absolute;
  top: 0;
  z-index: 2;
  min-width: 180px;
  padding: 8px 12px;
  pointer-events: none;
  border: 1px solid var(--chart-grid);
  border-radius: 12px;
  background: var(--chart-surface);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
}

.pace__scrub {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
