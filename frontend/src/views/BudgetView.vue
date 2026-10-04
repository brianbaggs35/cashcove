<script setup lang="ts">
import { PiggyBank, Plus, TrendingDown, TrendingUp } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  deleteBudget,
  fetchBudgetHistory,
  fetchBudgetPeriod,
  removeBudgetSource,
  type Budget,
  type BudgetHistory,
  type BudgetKind,
  type BudgetPeriodView,
  type BudgetSource,
} from '@/api/budget'
import { errorMessage } from '@/api/client'
import TabPage from '@/components/TabPage.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useBudgetsStore } from '@/stores/budgets'
import { useCategoriesStore } from '@/stores/categories'
import { todayIso } from '@/utils/dates'
import BudgetDialog from '@/views/budget/BudgetDialog.vue'
import BudgetHistoryChart from '@/views/budget/BudgetHistoryChart.vue'
import BudgetLinkDialog from '@/views/budget/BudgetLinkDialog.vue'
import BudgetPaceChart from '@/views/budget/BudgetPaceChart.vue'
import BudgetSources from '@/views/budget/BudgetSources.vue'
import BudgetSummary from '@/views/budget/BudgetSummary.vue'
import BudgetSwitcher from '@/views/budget/BudgetSwitcher.vue'
import BudgetTransactions from '@/views/budget/BudgetTransactions.vue'
import CategoryBars from '@/views/budget/CategoryBars.vue'
import PeriodNav from '@/views/budget/PeriodNav.vue'
import { periodLabel, thisPeriod } from '@/views/budget/periods'
import UpcomingBills from '@/views/budget/UpcomingBills.vue'

const REMEMBERED = 'cashcove:budget'

const auth = useAuthStore()
const budgets = useBudgetsStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const route = useRoute()
const router = useRouter()
const { locale, currency } = useHousehold()

const period = ref<BudgetPeriodView | null>(null)
const history = ref<BudgetHistory | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** Changes when what counts changed, so the list of what counts loads again. */
const version = ref(0)
let latest = 0

/** The budget someone looked at last, which they come back to. */
function remembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(REMEMBERED, id)
  } catch {
    // Nothing is lost: the first budget is shown next time instead.
  }
}

const asked = computed(() => (typeof route.query.budget === 'string' ? route.query.budget : null))
/** The budget being looked at: the one the address names, or the last one looked at, or the first. */
const selected = computed(
  () => budgets.find(asked.value) ?? budgets.find(remembered()) ?? budgets.budgets[0] ?? null,
)
/** Any day in the period being looked at, or none for the one the person is in. */
const on = computed(() => (typeof route.query.on === 'string' ? route.query.on : undefined))

async function loadPeriod() {
  const budget = selected.value
  if (!budget) return
  const request = ++latest
  loading.value = true
  error.value = null
  try {
    const query = { on: on.value, today: todayIso() }
    const [view, past] = await Promise.all([
      fetchBudgetPeriod(budget.id, query),
      fetchBudgetHistory(budget.id, query),
    ])
    if (request !== latest) return
    period.value = view
    history.value = past
  } catch (loadError) {
    if (request === latest) error.value = errorMessage(loadError)
  } finally {
    if (request === latest) loading.value = false
  }
}

/** What counts changed, so the budgets' own summaries, the period and its transactions are all asked for again. */
async function refresh() {
  version.value++
  await Promise.all([budgets.load(), loadPeriod()])
}

onMounted(() => {
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  void budgets.load()
})
// Once the budgets are known, and for another budget or another period of it. Another budget
// shows placeholders rather than the last one's numbers, and another period keeps them, dimmed.
watch(
  [() => selected.value?.id, on, () => budgets.loaded],
  ([id], [before]) => {
    if (id !== before) {
      period.value = null
      history.value = null
    }
    if (budgets.loaded) void loadPeriod()
  },
  { immediate: true },
)

function choose(id: string) {
  remember(id)
  void router.replace({ query: { budget: id } })
}

/** Where the period starting on a day is: the same budget, looked at on that day. */
function periodAt(start: string) {
  return { query: { ...route.query, on: start } }
}

/** Where the period the person is in is: no day, for the same budget. */
const currentPeriod = computed(() => ({ query: { budget: selected.value?.id } }))

// Making and changing budgets.
const dialog = ref(false)
const editing = ref<Budget | null>(null)

function add() {
  editing.value = null
  dialog.value = true
}

function edit() {
  // Only offered while a budget is being looked at.
  editing.value = selected.value
  dialog.value = true
}

async function saved(budget: Budget) {
  remember(budget.id)
  await budgets.load()
  await router.replace({ query: { budget: budget.id } })
  // The one being changed stays where it is, and a new one is looked at from the start.
  await loadPeriod()
}

async function remove() {
  const budget = selected.value as Budget
  const done = await confirmAndRun(
    {
      title: `Delete ${budget.name}?`,
      text: 'What counts toward it is forgotten. The transactions themselves, and their categories, stay as they are.',
      confirmText: 'Delete budget',
      tone: 'error',
      icon: PiggyBank,
    },
    () => deleteBudget(budget.id),
  )
  if (!done) return
  notify(`Deleted ${budget.name}`)
  period.value = null
  history.value = null
  await budgets.load()
  await router.replace({ query: {} })
  await loadPeriod()
}

// Choosing what counts.
const linking = ref(false)
const kind = ref<BudgetKind>('spending')

function addTo(next: BudgetKind) {
  kind.value = next
  linking.value = true
}

async function stopCounting(source: BudgetSource) {
  const budget = selected.value as Budget
  try {
    await removeBudgetSource(budget.id, source.id)
    notify(`Stopped counting ${source.name} in ${budget.name}`)
    await refresh()
  } catch (removeError) {
    error.value = errorMessage(removeError)
  }
}

const readonly = computed(() => !auth.isAdmin)
/** A period in words, e.g. "September 2026". */
const titleOf = (view: BudgetPeriodView) =>
  periodLabel(view.budget.period, view.start, view.end, locale.value)
const unset = computed(() => period.value?.sources.length === 0 && period.value.transactions === 0)
</script>

<template>
  <TabPage name="budget">
    <template v-if="auth.isAdmin && budgets.budgets.length" #actions>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Plus"
        data-test="budget-new"
        @click="add"
      >
        New budget
      </v-btn>
    </template>

    <ReadOnlyNotice
      v-if="readonly"
      text="You can see the budgets. Only an admin can change them."
    />

    <v-alert
      v-if="error || budgets.error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="`Couldn't load the budget. ${error ?? budgets.error}`"
      data-test="budget-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="budget-retry" @click="refresh">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-else-if="!budgets.loaded" data-test="budget-loading">
      <v-skeleton-loader type="heading" class="mb-4 rounded-xl" />
      <v-skeleton-loader type="card" class="rounded-xl" />
    </div>

    <v-card v-else-if="!budgets.budgets.length" data-test="budget-empty">
      <EmptyState
        :icon="PiggyBank"
        title="Plan with a budget"
        :text="
          auth.isAdmin
            ? 'A budget is an amount for a week, a month or a year. Choose what counts toward it, like your paycheck, your bills and the accounts you spend from, and Cashcove keeps track.'
            : 'An admin hasn’t made a budget yet.'
        "
      >
        <v-btn
          v-if="auth.isAdmin"
          color="primary"
          variant="flat"
          :prepend-icon="Plus"
          data-test="budget-first"
          @click="add"
        >
          Make a budget
        </v-btn>
      </EmptyState>
    </v-card>

    <template v-else>
      <BudgetSwitcher
        :budgets="budgets.budgets"
        :selected="selected?.id"
        :can-add="auth.isAdmin"
        class="mb-4"
        @select="choose"
        @add="add"
      />

      <div v-if="!period" data-test="budget-period-loading">
        <v-skeleton-loader type="heading" class="mb-4 rounded-xl" />
        <v-skeleton-loader type="card" class="rounded-xl" />
      </div>

      <div v-else :class="{ 'budget-view--loading': loading }" data-test="budget-period">
        <PeriodNav
          :title="titleOf(period)"
          :subtitle="period.current ? thisPeriod[period.budget.period] : undefined"
          :previous="period.previous ? periodAt(period.previous) : null"
          :next="period.next ? periodAt(period.next) : null"
          :current="period.current"
          :back="currentPeriod"
          :back-text="`Back to ${thisPeriod[period.budget.period]}`"
          class="mb-4"
        />

        <v-alert
          v-if="period.converted.length"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
          data-test="budget-converted"
        >
          Amounts in {{ period.converted.join(', ') }} are converted to {{ currency }} at each day's
          exchange rate.
        </v-alert>
        <v-alert
          v-if="period.unavailable.length"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
          data-test="budget-unavailable"
        >
          There's no exchange rate for {{ period.unavailable.join(', ') }}, so those transactions
          aren't counted.
        </v-alert>

        <v-card v-if="unset" class="mb-4" data-test="budget-unset">
          <v-card-text class="pa-5 d-flex flex-wrap align-center ga-4">
            <div class="flex-grow-1">
              <h3 class="text-title-medium font-weight-bold ma-0">Start by choosing what counts</h3>
              <p class="text-body-medium text-medium-emphasis ma-0 mt-1">
                {{
                  auth.isAdmin
                    ? 'Add your paycheck as income, then the bills, subscriptions, accounts or categories you spend on.'
                    : 'An admin hasn’t chosen what counts toward this budget yet.'
                }}
              </p>
            </div>
            <div v-if="auth.isAdmin" class="d-flex flex-wrap ga-2">
              <v-btn
                variant="tonal"
                color="success"
                :prepend-icon="TrendingUp"
                data-test="unset-income"
                @click="addTo('income')"
              >
                Add income
              </v-btn>
              <v-btn
                variant="tonal"
                color="primary"
                :prepend-icon="TrendingDown"
                data-test="unset-spending"
                @click="addTo('spending')"
              >
                Add spending
              </v-btn>
            </div>
          </v-card-text>
        </v-card>

        <v-row class="mb-0">
          <v-col cols="12" lg="5">
            <BudgetSummary
              :period="period"
              :readonly="readonly"
              class="h-100"
              @edit="edit"
              @delete="remove"
            />
          </v-col>
          <v-col cols="12" lg="7">
            <v-card class="h-100">
              <v-card-text class="pa-5">
                <BudgetPaceChart :period="period" />
              </v-card-text>
            </v-card>
          </v-col>
          <v-col v-if="history" cols="12" lg="7">
            <v-card class="h-100">
              <v-card-text class="pa-5">
                <BudgetHistoryChart
                  :history="history"
                  :kind="period.budget.period"
                  :selected="period.start"
                  @select="(start: string) => router.replace(periodAt(start))"
                />
              </v-card-text>
            </v-card>
          </v-col>
          <v-col cols="12" lg="5">
            <v-card class="h-100" data-test="budget-categories">
              <v-card-text class="pa-5">
                <h3 class="text-title-medium font-weight-bold ma-0">Where it went</h3>
                <p class="text-body-small text-medium-emphasis ma-0 mb-4">
                  Spending counted in this period, by category.
                </p>
                <CategoryBars v-if="period.categories.length" :categories="period.categories" />
                <p
                  v-else
                  class="text-body-medium text-medium-emphasis ma-0"
                  data-test="categories-empty"
                >
                  Nothing has been spent in this period.
                </p>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>

        <UpcomingBills
          v-if="period.upcoming.length"
          :bills="period.upcoming"
          :left="period.left"
          class="mt-1"
        />

        <BudgetSources
          :sources="period.sources"
          :income="period.income"
          :spent="period.spent"
          :readonly="readonly"
          class="mt-1 mb-2"
          @add="addTo"
          @remove="stopCounting"
        />
        <BudgetTransactions
          :budget-id="period.budget.id"
          :budget-name="period.budget.name"
          :on="period.start"
          :sources="period.sources"
          :removed="period.removed"
          :readonly="readonly"
          :version="version"
          @changed="refresh"
        />
      </div>
    </template>

    <BudgetDialog v-if="auth.isAdmin" v-model="dialog" :budget="editing" @saved="saved" />
    <BudgetLinkDialog
      v-if="auth.isAdmin && period"
      v-model="linking"
      :budget="period.budget"
      :kind="kind"
      :sources="period.sources"
      @added="refresh"
    />
  </TabPage>
</template>

<style scoped>
.budget-view--loading {
  opacity: 0.6;
  transition: opacity 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .budget-view--loading {
    transition: none;
  }
}
</style>
