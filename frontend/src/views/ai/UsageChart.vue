<script setup lang="ts">
import { ChartColumn } from '@lucide/vue'
import { computed, shallowRef } from 'vue'
import { useDisplay } from 'vuetify'

import type { UsageDay } from '@/api/ai'
import ChartFrame from '@/components/ui/ChartFrame.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { formatCost, formatTokens } from '@/utils/ai'
import { niceTicks, tipShift } from '@/views/budget/chart'
import { bucketize } from '@/views/ai/usage'

/**
 * What the AI cost, a bar for each day of a short range and for each week or month of a longer
 * one, drawn with Vuetify's own sparkline and readable as a table with every number in it.
 */
const props = defineProps<{ days: UsageDay[] }>()

const { locale } = useHousehold()
const { xs } = useDisplay()

const WIDTH = 480
const HEIGHT = 180
/** Space left between bars, and the widest one: a week of seven bars would otherwise be slabs. */
const GAP = 4
const WIDEST = 28

const buckets = computed(() => bucketize(props.days, locale.value))
const dollars = (micros: number) => micros / 1_000_000
const values = computed(() => buckets.value.map((bucket) => dollars(bucket.cost_micros)))
const hasCost = computed(() => values.value.some(Boolean))
const hasUse = computed(() => buckets.value.some((bucket) => bucket.calls))
const axis = computed(() => niceTicks(Math.max(...values.value)))
const slot = computed(() => WIDTH / buckets.value.length)
const ticks = computed(() =>
  axis.value.ticks.map((value) => ({
    value,
    label: formatCost(value * 1_000_000, locale.value),
    height: `${(value / axis.value.max) * 100}%`,
  })),
)
/** Every few bars is labelled, so the labels never run into each other. */
const every = computed(() => Math.max(1, Math.ceil(buckets.value.length / (xs.value ? 5 : 10))))

type Bucket = (typeof buckets.value)[number]

const latest = computed(() => buckets.value.length - 1)
/** The bar being read, with a pointer over it or the keyboard on the scrubber. */
const active = shallowRef<Bucket | null>(null)
const position = computed(() => (active.value ? buckets.value.indexOf(active.value) : -1))
const tip = computed(() => {
  if (!active.value) return null
  const centre = (position.value + 0.5) / buckets.value.length
  return {
    bucket: active.value,
    style: { left: `${centre * 100}%`, transform: `translateX(${tipShift(centre, 1)})` },
  }
})
/** What the scrubber says of the bar it is on, which is the latest until another is read. */
const reading = computed(() => describe(active.value ?? (buckets.value[latest.value] as Bucket)))

/** The bar under a pointer, by how far along the plot it is. */
function point(event: PointerEvent) {
  const rect = (event.currentTarget as Element).getBoundingClientRect()
  const along = (event.clientX - rect.left) / Math.max(rect.width, 1)
  const index = Math.min(latest.value, Math.max(0, Math.floor(along * buckets.value.length)))
  active.value = buckets.value[index] as Bucket
}

/** The scrubber has the keyboard: start reading from the latest bar. */
function arrive() {
  active.value ??= buckets.value[latest.value] as Bucket
}

/** The scrubber moved to another bar: the arrow keys, Home and End are the browser's to handle. */
function scrub(event: Event) {
  active.value = buckets.value[Number((event.target as HTMLInputElement).value)] as Bucket
}

function describe(bucket: Bucket): string {
  return `${bucket.full}: ${bucket.calls} calls, ${formatTokens(bucket.tokens, locale.value)} tokens, ${formatCost(bucket.cost_micros, locale.value)}`
}
</script>

<template>
  <v-card data-test="usage-chart">
    <v-card-text class="pa-5">
      <ChartFrame
        title="What it cost"
        description="Estimated at the provider’s list price, in US dollars."
        :rows="buckets.length"
      >
        <template #chart>
          <EmptyState
            v-if="!hasUse"
            compact
            :icon="ChartColumn"
            title="Nothing used yet"
            text="Each question and review shows up here with its cost."
          />
          <p
            v-else-if="!hasCost"
            class="text-body-medium text-medium-emphasis ma-0"
            data-test="usage-free"
          >
            Nothing here has a cost: the AI is running on your own computer, or on Ollama Cloud,
            whose price list doesn’t have the model.
          </p>
          <div v-else class="usage" :style="{ '--bars': buckets.length }" data-test="usage-plot">
            <div class="usage__axis" aria-hidden="true">
              <span v-for="tick in ticks" :key="tick.value" :style="{ bottom: tick.height }">
                {{ tick.label }}
              </span>
            </div>
            <div
              class="usage__plot"
              @pointermove="point"
              @pointerdown="point"
              @pointerleave="active = null"
            >
              <!-- Out of sight, and the keyboard's way to read the bars one by one. -->
              <input
                type="range"
                class="usage__scrub"
                min="0"
                :max="latest"
                step="1"
                :value="position < 0 ? latest : position"
                aria-label="What it cost, one period at a time"
                :aria-valuetext="reading"
                data-test="usage-scrub"
                @focus="arrive"
                @blur="active = null"
                @input="scrub"
                @keydown.esc="active = null"
              />
              <div class="usage__grid" aria-hidden="true">
                <span v-for="tick in ticks" :key="tick.value" :style="{ bottom: tick.height }" />
              </div>
              <div class="usage__bars" aria-hidden="true">
                <v-sparkline
                  type="bar"
                  :model-value="values"
                  :min="0"
                  :max="axis.max"
                  :width="WIDTH"
                  :height="HEIGHT"
                  :padding="slot / 2"
                  :line-width="Math.min(slot - GAP, WIDEST)"
                  :smooth="3"
                  color="var(--chart-income)"
                />
              </div>
              <div
                v-if="active"
                class="usage__cursor"
                :style="{
                  left: `${(position / buckets.length) * 100}%`,
                  width: `${100 / buckets.length}%`,
                }"
                aria-hidden="true"
                data-test="usage-cursor"
              />
              <div
                v-if="tip"
                class="usage__tip"
                :style="tip.style"
                aria-hidden="true"
                data-test="usage-tip"
              >
                <p class="text-body-small text-medium-emphasis ma-0">{{ tip.bucket.full }}</p>
                <p class="ma-0">
                  <strong class="tabular-nums">{{
                    formatCost(tip.bucket.cost_micros, locale)
                  }}</strong>
                </p>
                <p class="text-body-small ma-0 tabular-nums">
                  {{ tip.bucket.calls.toLocaleString('en-US') }} calls ·
                  {{ formatTokens(tip.bucket.tokens, locale) }} tokens
                </p>
              </div>
            </div>
            <div class="usage__labels" aria-hidden="true">
              <span v-for="(bucket, index) in buckets" :key="bucket.key">
                {{ index % every === 0 ? bucket.label : '' }}
              </span>
            </div>
          </div>
        </template>

        <template #table>
          <table data-test="usage-days-table">
            <caption>
              Calls, tokens and cost for each period
            </caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th v-if="!xs" scope="col">Calls</th>
                <th v-if="!xs" scope="col">Tokens</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="bucket in buckets" :key="bucket.key" data-test="usage-day-row">
                <th scope="row">
                  {{ bucket.full }}
                  <span v-if="xs" class="usage__more">
                    {{ bucket.calls.toLocaleString('en-US') }} calls ·
                    {{ formatTokens(bucket.tokens, locale) }} tokens
                  </span>
                </th>
                <td v-if="!xs">{{ bucket.calls.toLocaleString('en-US') }}</td>
                <td v-if="!xs">{{ formatTokens(bucket.tokens, locale) }}</td>
                <td>{{ formatCost(bucket.cost_micros, locale) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </ChartFrame>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.usage {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 6px 8px;
  max-width: 720px;
  margin-inline: auto;
}

.usage__axis {
  position: relative;
}

.usage__axis span {
  position: absolute;
  inset-inline: 0;
  transform: translateY(50%);
  font-size: 0.6875rem;
  line-height: 1;
  text-align: end;
  color: var(--chart-muted);
}

.usage__plot {
  position: relative;
  border-radius: 12px;
  touch-action: pan-y;
}

/* The scrubber is out of sight, so the chart itself shows when the keyboard is on it. */
.usage__plot:has(.usage__scrub:focus-visible) {
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.55);
}

.usage__scrub {
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

.usage__grid span {
  position: absolute;
  inset-inline: 0;
  height: 1px;
  background: var(--chart-grid);
}

/* Vuetify's chart is an <svg> of its own, which only the wrapper's styles can reach. */
.usage__bars :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

/* The bar being read is picked out behind its tip. */
.usage__cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  border-radius: 6px;
  background: var(--chart-grid);
}

.usage__tip {
  position: absolute;
  top: 0;
  z-index: 2;
  min-width: 160px;
  padding: 8px 12px;
  pointer-events: none;
  border: 1px solid var(--chart-grid);
  border-radius: 12px;
  background: var(--chart-surface);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
}

.usage__labels {
  grid-column: 2;
  display: grid;
  grid-template-columns: repeat(var(--bars), 1fr);
  font-size: 0.6875rem;
  color: var(--chart-muted);
}

/* A label wider than its bar spills over its quiet neighbours rather than being cut off. */
.usage__labels span {
  min-width: 0;
  overflow: visible;
  text-align: center;
  white-space: nowrap;
}

.usage__more {
  display: block;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--chart-muted);
}
</style>
