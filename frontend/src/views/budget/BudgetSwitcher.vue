<script setup lang="ts">
import { CircleCheck, Plus, TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'

import type { Budget } from '@/api/budget'
import { useHousehold } from '@/composables/useHousehold'
import { toCents } from '@/utils/money'
import { budgetStatus, percentSpent, periodTitles, statusColors } from '@/views/budget/periods'
import { useBudgetThreshold } from '@/views/budget/status'

/**
 * Every budget as a card to choose between, with how the period it's in is going. They scroll
 * sideways when there are more than fit, which a phone's swipe does too.
 */
const props = defineProps<{ budgets: Budget[]; selected?: string; canAdd: boolean }>()
const emit = defineEmits<{ select: [id: string]; add: [] }>()

const { money } = useHousehold()
const threshold = useBudgetThreshold()

const cards = computed(() =>
  props.budgets.map((budget) => {
    const { spent, amount } = budget.current
    const remaining = toCents(amount) - toCents(spent)
    return {
      budget,
      status: budgetStatus(spent, amount, threshold.value),
      percent: Math.min(100, percentSpent(spent, amount)),
      left: remaining < 0 ? `Over by ${money(-remaining / 100)}` : `${money(remaining / 100)} left`,
    }
  }),
)
</script>

<template>
  <v-slide-group
    show-arrows="desktop"
    class="budget-switcher"
    role="group"
    aria-label="Budgets"
    data-test="budget-switcher"
  >
    <v-slide-group-item v-for="card in cards" :key="card.budget.id">
      <button
        type="button"
        class="budget-card text-start"
        :class="{ 'budget-card--selected': card.budget.id === selected }"
        :aria-pressed="card.budget.id === selected"
        :data-test="`budget-card-${card.budget.id}`"
        @click="emit('select', card.budget.id)"
      >
        <span class="d-flex align-center ga-2">
          <span
            class="text-title-small font-weight-bold text-truncate"
            data-test="budget-card-name"
          >
            {{ card.budget.name }}
          </span>
          <v-chip size="x-small" variant="tonal" class="flex-shrink-0">
            {{ periodTitles[card.budget.period] }}
          </v-chip>
        </span>
        <span
          class="text-body-small text-medium-emphasis tabular-nums mt-1"
          data-test="budget-card-amount"
        >
          {{ money(card.budget.current.spent) }} of {{ money(card.budget.current.amount) }}
        </span>
        <v-progress-linear
          :model-value="card.percent"
          :color="statusColors[card.status]"
          height="6"
          rounded
          class="my-2"
          aria-hidden="true"
        />
        <span
          class="text-body-small font-weight-medium d-flex align-center ga-1"
          :class="{ 'text-error': card.status === 'over' }"
          data-test="budget-card-left"
        >
          <v-icon :icon="card.status === 'ok' ? CircleCheck : TriangleAlert" size="14" />
          {{ card.left }}
        </span>
      </button>
    </v-slide-group-item>
    <v-slide-group-item v-if="canAdd">
      <button
        type="button"
        class="budget-card budget-card--add d-flex flex-column align-center justify-center ga-1"
        data-test="budget-add"
        @click="emit('add')"
      >
        <v-icon :icon="Plus" size="22" />
        <span class="text-title-small font-weight-bold">New budget</span>
      </button>
    </v-slide-group-item>
  </v-slide-group>
</template>

<style scoped>
.budget-switcher :deep(.v-slide-group__content) {
  gap: 12px;
  padding: 4px 2px;
}

.budget-card {
  display: flex;
  flex-direction: column;
  width: 220px;
  min-height: 112px;
  padding: 14px 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 20px;
  background: rgb(var(--v-theme-surface));
  color: inherit;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.budget-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
}

.budget-card:focus-visible {
  outline: 3px solid rgba(var(--v-theme-primary), 0.55);
  outline-offset: 2px;
}

.budget-card--selected {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
}

.budget-card--add {
  width: 150px;
  border-style: dashed;
  color: rgb(var(--v-theme-primary));
  background: transparent;
}

@media (max-width: 600px) {
  .budget-card {
    width: 208px;
  }

  .budget-card--add {
    width: 130px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .budget-card {
    transition: none;
  }
}
</style>
