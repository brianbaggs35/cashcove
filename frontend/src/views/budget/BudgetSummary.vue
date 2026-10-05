<script setup lang="ts">
import {
  CircleCheck,
  EllipsisVertical,
  Pencil,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from '@lucide/vue'
import { computed } from 'vue'

import type { BudgetPeriodView } from '@/api/budget'
import { useHousehold } from '@/composables/useHousehold'
import { toCents } from '@/utils/money'
import { budgetStatus, percentSpent, statusColors } from '@/views/budget/periods'
import { useBudgetThreshold } from '@/views/budget/status'

/** How a period is going at a glance: what's left to spend, how far through the amount spending is, and what came in and went out. */
const props = defineProps<{ period: BudgetPeriodView; readonly: boolean }>()
const emit = defineEmits<{ edit: []; delete: [] }>()

const { money } = useHousehold()
const threshold = useBudgetThreshold()

const left = computed(() => toCents(props.period.left))
const over = computed(() => left.value < 0)
const percent = computed(() => percentSpent(props.period.spent, props.period.amount))
const status = computed(() =>
  budgetStatus(props.period.spent, props.period.amount, threshold.value),
)
/** Where an even pace would have the spending by now, as a share of the amount. */
const pace = computed(() => {
  const { expected, amount } = props.period
  const limit = toCents(amount)
  if (expected === null || limit <= 0) return null
  return {
    left: Math.min(100, (toCents(expected) / limit) * 100),
    title: `An even pace would have spent ${money(expected)} by now`,
  }
})
const goingOver = computed(
  () =>
    props.period.projected !== null &&
    toCents(props.period.projected) > toCents(props.period.amount),
)

interface Chip {
  text: string
  color: 'success' | 'warning' | 'error'
  icon: LucideIcon
}

/** What to say about how it's going: nothing for a period that hasn't begun. */
const chip = computed<Chip | null>(() => {
  const { current, days_gone: gone } = props.period
  if (status.value === 'over') return { text: 'Over budget', color: 'error', icon: TriangleAlert }
  if (!current && gone === 0) return null
  if (status.value === 'near') {
    return { text: 'Close to the limit', color: 'warning', icon: TriangleAlert }
  }
  if (goingOver.value) {
    return { text: 'On pace to go over', color: 'warning', icon: TriangleAlert }
  }
  return { text: current ? 'On track' : 'Within budget', color: 'success', icon: CircleCheck }
})

const timeLeft = computed(() => {
  const { current, days, days_gone: gone } = props.period
  if (!current) return gone === 0 ? 'Not started yet' : 'Period over'
  const days_left = days - gone
  if (days_left === 0) return 'Last day'
  return days_left === 1 ? '1 day left' : `${days_left} days left`
})

const paceNote = computed(() => {
  const { projected, amount } = props.period
  if (projected === null) return null
  const difference = toCents(projected) - toCents(amount)
  if (difference === 0) return `At this pace you'll spend ${money(projected)}, right on budget.`
  return `At this pace you'll spend ${money(projected)}, which is ${money(Math.abs(difference) / 100)} ${
    difference > 0 ? 'over' : 'under'
  } budget.`
})

const tiles = computed(() => [
  {
    key: 'income',
    label: 'Income',
    hint: undefined,
    value: money(props.period.income),
    swatch: 'income',
  },
  {
    key: 'spent',
    label: 'Spent',
    hint: undefined,
    value: money(props.period.spent),
    swatch: 'spent',
  },
  {
    key: 'net',
    label: 'Net',
    hint: 'Income less spending',
    value: money(props.period.saved, undefined, 'exceptZero'),
    swatch: null,
  },
])
</script>

<template>
  <v-card data-test="budget-summary">
    <v-card-text class="pa-5 pa-md-6">
      <div class="d-flex align-start ga-3">
        <div class="flex-grow-1 min-width-0">
          <div class="d-flex align-center flex-wrap ga-2 mb-1">
            <p class="text-label-large text-medium-emphasis ma-0" data-test="summary-heading">
              {{ over ? 'Overspent by' : 'Left to spend' }}
            </p>
            <v-chip
              v-if="chip"
              :color="chip.color"
              size="small"
              variant="tonal"
              :prepend-icon="chip.icon"
              data-test="summary-status"
            >
              {{ chip.text }}
            </v-chip>
          </div>
          <p
            class="summary__figure font-weight-bold ma-0 tabular-nums"
            :class="{ 'text-error': over }"
            data-test="summary-left"
          >
            {{ money(Math.abs(left) / 100) }}
          </p>
          <p class="text-body-medium text-medium-emphasis ma-0 mt-1" data-test="summary-of">
            of {{ money(period.amount) }} for the period
          </p>
        </div>
        <v-menu v-if="!readonly" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="EllipsisVertical"
              variant="text"
              size="small"
              :aria-label="`Actions for ${period.budget.name}`"
              data-test="budget-actions"
            />
          </template>
          <v-list density="compact" nav min-width="200">
            <v-list-item
              :prepend-icon="Pencil"
              title="Edit budget"
              data-test="budget-edit"
              @click="emit('edit')"
            />
            <v-list-item
              :prepend-icon="Trash2"
              title="Delete budget"
              base-color="error"
              data-test="budget-delete"
              @click="emit('delete')"
            />
          </v-list>
        </v-menu>
      </div>

      <div class="summary__meter mt-5">
        <v-progress-linear
          :model-value="Math.min(100, Math.max(0, percent))"
          :color="statusColors[status]"
          bg-color="on-surface"
          bg-opacity="0.1"
          height="12"
          rounded
          :aria-label="`${percent}% of the budget spent`"
          data-test="summary-meter"
        />
        <div
          v-if="pace"
          class="summary__pace"
          :style="{ left: `${pace.left}%` }"
          :title="pace.title"
          data-test="summary-pace"
        />
      </div>
      <div class="d-flex justify-space-between ga-3 mt-2 text-body-small text-medium-emphasis">
        <span class="tabular-nums" data-test="summary-percent">{{ percent }}% spent</span>
        <span data-test="summary-time">{{ timeLeft }}</span>
      </div>
      <p v-if="paceNote" class="text-body-medium mt-3 mb-0" data-test="summary-pace-note">
        {{ paceNote }}
      </p>

      <v-divider class="my-5" />
      <dl class="summary__tiles">
        <div
          v-for="tile in tiles"
          :key="tile.key"
          class="summary__tile"
          :data-test="`tile-${tile.key}`"
        >
          <dt
            class="text-body-small text-medium-emphasis d-flex align-center ga-2"
            :title="tile.hint"
          >
            <span
              v-if="tile.swatch"
              class="chart summary__swatch"
              :class="`summary__swatch--${tile.swatch}`"
              aria-hidden="true"
            />
            {{ tile.label }}
          </dt>
          <dd class="text-title-large font-weight-bold tabular-nums ma-0" data-test="tile-value">
            {{ tile.value }}
          </dd>
        </div>
      </dl>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.min-width-0 {
  min-width: 0;
}

.summary__figure {
  font-size: 2.5rem;
  line-height: 1.1;
}

.summary__meter {
  position: relative;
}

/* Where an even pace would have the spending by now. */
.summary__pace {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 3px;
  margin-left: -1px;
  border-radius: 2px;
  background: rgb(var(--v-theme-on-surface));
}

.summary__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
  gap: 16px;
  margin: 0;
}

.summary__swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.summary__swatch--income {
  background: var(--chart-income);
}

.summary__swatch--spent {
  background: var(--chart-spent);
}

@media (max-width: 600px) {
  .summary__figure {
    font-size: 2rem;
  }
}
</style>
