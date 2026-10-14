<script setup lang="ts">
import { computed, ref } from 'vue'

import type { PaymentPoint } from '@/api/subscriptions'
import ChartFrame from '@/components/ui/ChartFrame.vue'
import { useHousehold } from '@/composables/useHousehold'
import { fromIsoDate } from '@/utils/dates'
import { toCents } from '@/utils/money'
import { compactMoney, niceTicks, tipShift } from '@/views/budget/chart'

/**
 * What each of the latest payments came to, as a bar apiece, with the average they come to drawn
 * across them. Point at a payment, or move between them with the arrow keys, to read it.
 */
const props = defineProps<{ history: PaymentPoint[]; currency?: string }>()

const { money, locale, currency: householdCurrency } = useHousehold()

const WIDTH = 480
const HEIGHT = 180
/** Space left between neighbouring bars, and the widest a bar gets when there are only a few. */
const GAP = 4
const WIDEST = 36

const unit = computed(() => props.currency ?? householdCurrency.value)
const dollars = (amount: string) => Math.max(0, toCents(amount) / 100)
const values = computed(() => props.history.map((point) => dollars(point.amount)))
const axis = computed(() => niceTicks(Math.max(...values.value)))
const ticks = computed(() =>
  axis.value.ticks.map((value) => ({
    value,
    label: compactMoney(value, unit.value, locale.value),
    height: `${(value / axis.value.max) * 100}%`,
  })),
)
const barWidth = computed(() => Math.min(WIDEST, WIDTH / props.history.length - GAP))

/** The average of the payments drawn, as a share of the height of the plot. */
const average = computed(() => {
  const cents = props.history.reduce((total, point) => total + toCents(point.amount), 0)
  const value = cents / props.history.length / 100
  return { text: money(value, unit.value), height: `${(value / axis.value.max) * 100}%` }
})

const day = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale.value, options).format(fromIsoDate(date))

const rows = computed(() =>
  props.history.map((point, index) => {
    const before = props.history[index - 1]
    const change = before ? toCents(point.amount) - toCents(before.amount) : null
    return {
      index,
      on: point.on,
      date: day(point.on, { dateStyle: 'medium' }),
      weekday: day(point.on, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      axis: day(point.on, { month: 'short', year: '2-digit' }),
      amount: money(point.amount, unit.value),
      change: change === null ? null : money(change / 100, unit.value, 'exceptZero'),
      // In words, since the table and the scrubber can't show a colour.
      versus: describeChange(change),
    }
  }),
)

type Row = (typeof rows.value)[number]

function describeChange(change: number | null): string {
  if (change === null) return 'the earliest shown'
  if (change === 0) return 'the same as the one before'
  const by = money(Math.abs(change) / 100, unit.value)
  return change > 0 ? `${by} more than the one before` : `${by} less than the one before`
}

/** Labels under the first, middle and last bars: every one would crowd a phone. */
const labels = computed(() => {
  const last = rows.value.length - 1
  return [...new Set([0, Math.round(last / 2), last])].map((index) => ({
    index,
    text: (rows.value[index] as Row).axis,
    place: `${((index + 0.5) / rows.value.length) * 100}%`,
  }))
})

// Reading one payment.
const focus = ref<number | null>(null)
const reading = computed(() => {
  const row = focus.value === null ? null : rows.value[focus.value]
  if (!row) return null
  const centre = (row.index + 0.5) / rows.value.length
  return {
    row,
    style: { left: `${centre * 100}%`, transform: `translateX(${tipShift(centre, 1)})` },
  }
})
const latest = computed(() => rows.value.length - 1)
const valueText = computed(() => {
  const row = rows.value[focus.value ?? latest.value] as Row
  return `${row.weekday}: ${row.amount}, ${row.versus}.`
})

function point(event: PointerEvent) {
  const rect = (event.currentTarget as Element).getBoundingClientRect()
  const position = (event.clientX - rect.left) / (rect.width || WIDTH)
  focus.value = Math.min(latest.value, Math.max(0, Math.floor(position * rows.value.length)))
}

/** The scrubber has the keyboard: start reading from the latest payment. */
function arrive() {
  focus.value ??= latest.value
}

function scrub(event: Event) {
  focus.value = Number((event.target as HTMLInputElement).value)
}
</script>

<template>
  <ChartFrame
    title="What each payment cost"
    :description="`Each of the latest ${history.length} payments, oldest to newest, against what they average.`"
    :rows="rows.length"
  >
    <template #legend>
      <span class="d-flex align-center ga-2 text-body-small">
        <span class="paid__key paid__key--bar" aria-hidden="true" />Payment
      </span>
      <span class="d-flex align-center ga-2 text-body-small" data-test="payment-average-key">
        <span class="paid__key paid__key--average" aria-hidden="true" />Average {{ average.text }}
      </span>
    </template>

    <template #chart>
      <div class="paid" data-test="payment-chart">
        <!-- Out of sight, and the keyboard's way to read the payments one by one. -->
        <input
          type="range"
          class="paid__scrub"
          min="0"
          :max="latest"
          step="1"
          :value="focus ?? latest"
          aria-label="Payments, one by one"
          :aria-valuetext="valueText"
          data-test="payment-scrub"
          @focus="arrive"
          @blur="focus = null"
          @input="scrub"
          @keydown.esc="focus = null"
        />
        <div class="paid__chart">
          <div class="paid__axis" aria-hidden="true">
            <span v-for="tick in ticks" :key="tick.value" :style="{ bottom: tick.height }">
              {{ tick.label }}
            </span>
          </div>
          <div
            class="paid__plot"
            aria-hidden="true"
            @pointermove="point"
            @pointerleave="focus = null"
          >
            <div class="paid__grid">
              <span v-for="tick in ticks" :key="tick.value" :style="{ bottom: tick.height }" />
            </div>
            <v-sparkline
              type="bar"
              :model-value="values"
              :min="0"
              :max="axis.max"
              :width="WIDTH"
              :height="HEIGHT"
              :line-width="barWidth"
              :smooth="3"
              color="var(--chart-spent)"
            />
            <span
              class="paid__mean"
              :style="{ bottom: average.height }"
              data-test="payment-average"
            />
            <span
              v-if="reading"
              class="paid__column"
              :style="{
                left: `${(reading.row.index / rows.length) * 100}%`,
                width: `${100 / rows.length}%`,
              }"
            />
            <div v-if="reading" class="paid__tip" :style="reading.style" data-test="payment-tip">
              <p class="text-body-small text-medium-emphasis ma-0">{{ reading.row.date }}</p>
              <p class="ma-0">
                <strong class="tabular-nums">{{ reading.row.amount }}</strong>
              </p>
              <p class="text-body-small ma-0">{{ reading.row.versus }}</p>
            </div>
          </div>
          <div class="paid__labels" aria-hidden="true">
            <span v-for="label in labels" :key="label.index" :style="{ left: label.place }">
              {{ label.text }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <template #table="{ limit }">
      <table data-test="payment-table">
        <caption>
          Each of the latest payments, and how it changed from the one before
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Paid</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in [...rows].reverse().slice(0, limit)"
            :key="row.on + row.index"
            data-test="payment-row"
          >
            <th scope="row">{{ row.date }}</th>
            <td>{{ row.amount }}</td>
            <td>{{ row.change ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </ChartFrame>
</template>

<style scoped>
.paid {
  position: relative;
  border-radius: 12px;
}

/* The scrubber is out of sight, so the chart itself shows when the keyboard is on it. */
.paid:has(.paid__scrub:focus-visible) {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.55);
}

.paid__chart {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 6px 8px;
  max-width: 720px;
  margin-inline: auto;
}

.paid__axis {
  position: relative;
}

.paid__axis span {
  position: absolute;
  inset-inline: 0;
  transform: translateY(50%);
  font-size: 0.6875rem;
  line-height: 1;
  text-align: end;
  color: var(--chart-muted);
}

.paid__plot {
  position: relative;
  touch-action: pan-y;
}

.paid__grid span {
  position: absolute;
  inset-inline: 0;
  height: 1px;
  background: var(--chart-grid);
}

/* Vuetify's chart is an <svg> of its own, which only the wrapper's styles can reach. */
.paid__plot :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

.paid__mean {
  position: absolute;
  inset-inline: 0;
  border-top: 2px dashed var(--chart-ink);
  pointer-events: none;
}

.paid__column {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--chart-grid);
  opacity: 0.5;
  pointer-events: none;
}

.paid__tip {
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

.paid__labels {
  position: relative;
  grid-column: 2;
  height: 1rem;
  font-size: 0.75rem;
  color: var(--chart-muted);
}

.paid__labels span {
  position: absolute;
  white-space: nowrap;
  transform: translateX(-50%);
}

.paid__labels span:first-child {
  transform: none;
}

.paid__labels span:last-child {
  transform: translateX(-100%);
}

.paid__key {
  display: inline-block;
  flex-shrink: 0;
}

.paid__key--bar {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--chart-spent);
}

.paid__key--average {
  width: 16px;
  border-top: 2px dashed var(--chart-ink);
}

.paid__scrub {
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
