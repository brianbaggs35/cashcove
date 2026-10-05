<script setup lang="ts">
import { CalendarDays, Minus, TrendingDown, TrendingUp } from '@lucide/vue'
import { computed } from 'vue'

import type { Dashboard } from '@/api/dashboard'
import { useHousehold } from '@/composables/useHousehold'
import { fromIsoDate } from '@/utils/dates'
import { fromCents, toCents } from '@/utils/money'
import { runningTotal } from '@/views/budget/chart'
import { changeBetween, toneOf, type Direction, type Tone } from '@/views/dashboard/summary'

/**
 * How this month is going: what came in, what was spent and what is left over, each next to what
 * it was by this time last month, and how spending has built up day by day.
 */
const props = defineProps<{ dashboard: Dashboard }>()

const { money, locale } = useHousehold()

const month = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(
    fromIsoDate(props.dashboard.month.start),
  ),
)
const elapsed = computed(() => (props.dashboard.days_gone / props.dashboard.days) * 100)

const icons: Record<Direction, typeof Minus> = { up: TrendingUp, down: TrendingDown, same: Minus }
const comparisons: Record<Direction, string> = {
  up: 'more than',
  down: 'less than',
  same: 'the same as',
}
const toneClasses: Record<Tone, string> = {
  good: 'text-success',
  bad: 'text-error',
  neutral: 'text-medium-emphasis',
}

const saved = computed(() =>
  fromCents(toCents(props.dashboard.month.income) - toCents(props.dashboard.month.spent)),
)
const savedBefore = computed(() =>
  fromCents(toCents(props.dashboard.previous.income) - toCents(props.dashboard.previous.spent)),
)

const tiles = computed(() => {
  const { month: now, previous } = props.dashboard
  return [
    { key: 'income', label: 'Income', value: now.income, before: previous.income, upIsGood: true },
    { key: 'spent', label: 'Spent', value: now.spent, before: previous.spent, upIsGood: false },
    { key: 'saved', label: 'Saved', value: saved.value, before: savedBefore.value, upIsGood: true },
  ].map((tile) => {
    const change = changeBetween(tile.value, tile.before)
    return {
      ...tile,
      text: money(tile.value),
      negative: toCents(tile.value) < 0,
      icon: icons[change.direction],
      tone: toneClasses[toneOf(change.direction, tile.upIsGood)],
      change:
        change.direction === 'same'
          ? 'The same as this time last month'
          : `${money(change.cents / 100)} ${comparisons[change.direction]} this time last month`,
    }
  })
})

/** What had been spent by the end of each day so far, which says how the month is going. */
const pace = computed(() =>
  runningTotal(props.dashboard.daily, props.dashboard.month.start, props.dashboard.days_gone - 1),
)
</script>

<template>
  <v-card class="chart month h-100" data-test="month-summary">
    <v-card-text class="pa-5 pa-md-6">
      <header class="d-flex align-center flex-wrap ga-2 mb-3">
        <v-icon :icon="CalendarDays" size="20" class="text-medium-emphasis" />
        <h2 class="text-title-medium font-weight-bold ma-0 flex-grow-1" data-test="month-title">
          {{ month }}
        </h2>
        <v-chip size="small" variant="tonal" data-test="month-day">
          Day {{ dashboard.days_gone }} of {{ dashboard.days }}
        </v-chip>
      </header>
      <v-progress-linear
        :model-value="elapsed"
        height="6"
        rounded
        color="primary"
        aria-label="How much of the month has gone"
        class="mb-5"
      />

      <dl class="month__tiles ma-0">
        <div
          v-for="tile in tiles"
          :key="tile.key"
          class="month__tile"
          :data-test="`month-${tile.key}`"
        >
          <dt class="d-flex align-center ga-2 text-label-large text-medium-emphasis">
            <span
              v-if="tile.key !== 'saved'"
              class="month__key"
              :class="`month__key--${tile.key}`"
              aria-hidden="true"
            />
            {{ tile.label }}
          </dt>
          <dd class="ma-0">
            <span
              class="month__value text-headline-small font-weight-bold"
              :class="{ 'text-error': tile.negative }"
              data-test="month-value"
            >
              {{ tile.text }}
            </span>
            <span
              class="month__change d-flex align-start ga-1 text-body-small mt-1"
              :class="tile.tone"
              data-test="month-change"
            >
              <v-icon :icon="tile.icon" size="14" class="mt-1" aria-hidden="true" />
              <span>{{ tile.change }}</span>
            </span>
          </dd>
        </div>
      </dl>

      <section v-if="pace.length > 1" class="mt-5" data-test="month-pace">
        <p class="text-label-large text-medium-emphasis mb-1">Spending so far this month</p>
        <div class="month__chart" aria-hidden="true">
          <div
            v-for="layer in ['wash', 'line']"
            :key="layer"
            class="month__layer"
            :class="`month__layer--${layer}`"
          >
            <v-sparkline
              :model-value="pace"
              type="trend"
              :fill="layer === 'wash'"
              smooth
              :min="0"
              :height="64"
              :width="400"
              :line-width="2"
              :padding="4"
              color="var(--chart-spent)"
            />
          </div>
        </div>
      </section>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.month__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 20px 24px;
}

.month__value {
  display: block;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.month__key {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

.month__key--income {
  background: var(--chart-income);
}

.month__key--spent {
  background: var(--chart-spent);
}

.month__chart {
  position: relative;
}

/* Vuetify's chart is an <svg> of its own, which only the wrapper's styles can reach. */
.month__layer :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

/* The line sits exactly on its own area, which is only a wash of the same colour. */
.month__layer--wash {
  opacity: 0.14;
}

.month__layer--line {
  position: absolute;
  inset: 0;
}
</style>
