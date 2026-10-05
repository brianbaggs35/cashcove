<script setup lang="ts">
import { PiggyBank, Plus } from '@lucide/vue'
import { computed } from 'vue'

import type { Budget } from '@/api/budget'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAuthStore } from '@/stores/auth'
import { toCents } from '@/utils/money'
import DashboardCard from '@/views/dashboard/DashboardCard.vue'
import { budgetStatus, percentSpent, periodTitles, statusColors } from '@/views/budget/periods'
import { useBudgetThreshold } from '@/views/budget/status'

/** How each budget is going in the period it is in: how much of its amount is spent, and what is left. */
const props = defineProps<{ budgets: Budget[] }>()

/** How many budgets are listed before the rest are left to the Budget tab. */
const SHOWN = 4

const auth = useAuthStore()
const { money } = useHousehold()
const threshold = useBudgetThreshold()

const rows = computed(() =>
  props.budgets.slice(0, SHOWN).map((budget) => {
    const { spent, amount } = budget.current
    const status = budgetStatus(spent, amount, threshold.value)
    const left = toCents(amount) - toCents(spent)
    return {
      id: budget.id,
      name: budget.name,
      period: periodTitles[budget.period],
      percent: percentSpent(spent, amount),
      color: statusColors[status],
      spent: money(spent),
      amount: money(amount),
      left: left < 0 ? `${money(-left / 100)} over` : `${money(left / 100)} left`,
      over: status === 'over',
    }
  }),
)
const more = computed(() => props.budgets.length - SHOWN)
</script>

<template>
  <DashboardCard
    title="Budgets"
    :icon="PiggyBank"
    :to="budgets.length ? '/budget' : undefined"
    data-test="budget-progress"
  >
    <EmptyState
      v-if="!budgets.length"
      compact
      :icon="PiggyBank"
      title="No budgets yet"
      :text="
        auth.isAdmin
          ? 'Set an amount for a week, a month or a year and see how you are doing.'
          : 'An admin hasn\'t made a budget yet.'
      "
    >
      <v-btn
        v-if="auth.isAdmin"
        to="/budget"
        color="primary"
        variant="flat"
        :prepend-icon="Plus"
        data-test="budget-progress-add"
      >
        Make a budget
      </v-btn>
    </EmptyState>
    <ul v-else class="budgets pa-0 ma-0">
      <li v-for="row in rows" :key="row.id" data-test="budget-progress-row">
        <router-link
          :to="{ path: '/budget', query: { budget: row.id } }"
          class="budgets__link"
          data-test="budget-progress-link"
        >
          <div class="d-flex align-baseline flex-wrap gc-2">
            <span class="text-body-medium font-weight-medium text-truncate">{{ row.name }}</span>
            <span class="text-body-small text-medium-emphasis flex-grow-1">{{ row.period }}</span>
            <span
              class="text-body-medium font-weight-bold tabular-nums"
              :class="{ 'text-error': row.over }"
              data-test="budget-progress-left"
            >
              {{ row.left }}
            </span>
          </div>
          <v-progress-linear
            :model-value="Math.min(100, row.percent)"
            :color="row.color"
            height="8"
            rounded
            class="my-1"
            :aria-label="`${row.name}: ${row.percent}% spent`"
          />
          <p class="text-body-small text-medium-emphasis tabular-nums ma-0">
            {{ row.spent }} of {{ row.amount }} · {{ row.percent }}%
          </p>
        </router-link>
      </li>
    </ul>
    <p
      v-if="more > 0"
      class="text-body-small text-medium-emphasis mt-3 mb-0"
      data-test="budget-progress-more"
    >
      And {{ more }} more in the Budget tab.
    </p>
  </DashboardCard>
</template>

<style scoped>
.budgets {
  display: grid;
  gap: 18px;
  list-style: none;
}

.budgets__link {
  display: block;
  color: inherit;
  text-decoration: none;
  border-radius: 8px;
}

.budgets__link:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 4px;
}
</style>
