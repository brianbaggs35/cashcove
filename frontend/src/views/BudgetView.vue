<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChartPie,
  Link,
  Plus,
  Search,
  Trash2,
  Wallet,
} from '@lucide/vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  deleteCategoryBudget,
  fetchBudgetConfigurations,
  fetchBudgetMonth,
  fetchBudgetYear,
  linkBudgetTransaction,
  linkBudgetSubscription,
  saveCategoryBudget,
  unlinkBudgetSubscription,
  unlinkBudgetTransaction,
  type BudgetConfiguration,
  type BudgetLine,
  type BudgetMonth,
  type BudgetPeriod,
  type BudgetYear,
  type CategoryKind,
} from '@/api/budget'
import { errorMessage } from '@/api/client'
import { fetchSubscriptions, type Subscription } from '@/api/subscriptions'
import { fetchTransactions, type Transaction } from '@/api/transactions'
import TabPage from '@/components/TabPage.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { todayIso } from '@/utils/dates'
import { formatMoney } from '@/utils/format'
import { fromCents, toCents } from '@/utils/money'
import BudgetProgress from '@/views/budget/BudgetProgress.vue'
import BudgetYearChart from '@/views/budget/BudgetYearChart.vue'

// The months the API will budget: a cleared or half-typed month field isn't one.
const FIRST_MONTH = '1970-01'
const LAST_MONTH = '2199-12'
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

const periods: { title: string; value: BudgetPeriod }[] = [
  { title: 'Weekly', value: 'weekly' },
  { title: 'Every two weeks', value: 'biweekly' },
  { title: 'Monthly', value: 'monthly' },
  { title: 'Yearly', value: 'yearly' },
]
const scopeOptions = [
  { title: 'This month and onward', value: 'onward' },
  { title: 'This month only', value: 'only' },
]
const periodTitles: Record<BudgetPeriod, string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

const auth = useAuthStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const preferences = usePreferencesStore()
const selectedMonth = ref(todayIso().slice(0, 7))
const monthField = computed({
  get: () => selectedMonth.value,
  set: (value: string | null) => {
    if (isBudgetMonth(value)) selectedMonth.value = value
  },
})
const monthBudget = ref<BudgetMonth | null>(null)
const budgetYear = ref<BudgetYear | null>(null)
const configurations = ref<BudgetConfiguration[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const budgetDialog = ref(false)
const editing = ref<{ line: BudgetLine; kind: CategoryKind } | null>(null)
const saving = ref(false)
const budgetForm = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)
interface BudgetForm {
  period: BudgetPeriod
  amount: string | null
  scope: 'onward' | 'only'
  rollover: boolean
  cycleAnchor: string
  accountIds: string[]
}

const form = reactive<BudgetForm>({
  period: 'monthly',
  amount: null,
  scope: 'onward',
  rollover: false,
  cycleAnchor: '',
  accountIds: [],
})
const transactionDialog = ref(false)
const linkedCategory = ref<{ id: string; name: string; kind: CategoryKind } | null>(null)
const linkableTransactions = ref<Transaction[]>([])
const transactionLoading = ref(false)
const transactionError = ref<string | null>(null)
const transactionAction = ref<string | null>(null)
const subscriptionDialog = ref(false)
const subscriptionCategory = ref<{ id: string; name: string } | null>(null)
const linkableSubscriptions = ref<Subscription[]>([])
const subscriptionLoading = ref(false)
const subscriptionError = ref<string | null>(null)
const subscriptionAction = ref<string | null>(null)
let request = 0
let transactionRequest = 0
let subscriptionRequest = 0

function isBudgetMonth(value: string | null): value is string {
  return !!value && MONTH_PATTERN.test(value) && value >= FIRST_MONTH && value <= LAST_MONTH
}

function monthOffset(month: string, offset: number): string {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthStart(month: string): string {
  return `${month}-01`
}

function monthEnd(month: string): string {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return date.toISOString().slice(0, 10)
}

function monthTitle(month: string): string {
  return new Intl.DateTimeFormat(preferences.saved?.general.locale ?? 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00.000Z`))
}

const title = computed(() => monthTitle(selectedMonth.value))
const currency = computed(
  () => monthBudget.value?.currency ?? preferences.saved?.general.currency ?? 'USD',
)
const alertSettings = computed(() => preferences.saved?.alerts)
const alertThreshold = computed(() => alertSettings.value?.budget_threshold_percent ?? 90)
const enabledAlertThreshold = computed(() =>
  alertSettings.value?.budget_threshold_enabled ? alertThreshold.value : 101,
)
const accountItems = computed(() =>
  accounts.open
    .filter((account) => account.currency === currency.value)
    .map((account) => ({
      title: account.name,
      value: account.id,
      props: { subtitle: account.institution ?? undefined },
    })),
)
const periodLabel = (period: BudgetPeriod) => periodTitles[period]
const configFor = (categoryId: string) =>
  configurations.value.find((item) => item.category_id === categoryId)
const selectedBudgeted = computed(() => monthBudget.value?.spending.budgeted ?? '0.00')
const selectedCarried = computed(() => monthBudget.value?.spending.carried ?? '0.00')
const spendingLimit = computed(() =>
  fromCents(toCents(selectedBudgeted.value) + toCents(selectedCarried.value)),
)
const budgetedIncome = computed(() => monthBudget.value?.income.budgeted ?? '0.00')
const receivedIncome = computed(() => monthBudget.value?.income.actual ?? '0.00')
const unbudgeted = computed(
  () =>
    !!monthBudget.value &&
    monthBudget.value.groups.every((group) =>
      group.categories.every((line) => line.amount === null),
    ),
)
const noCategories = computed(
  () =>
    loaded.value &&
    !!monthBudget.value &&
    monthBudget.value.groups.every((group) => group.categories.length === 0),
)
const visibleGroups = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return (monthBudget.value?.groups ?? [])
    .map((group) => ({
      ...group,
      categories: group.categories.filter((line) => {
        const configuration = configFor(line.category_id)
        const accountText =
          configuration?.account_ids
            .map((id) => accounts.find(id)?.name ?? '')
            .join(' ')
            .toLocaleLowerCase() ?? ''
        return (
          !query ||
          line.name.toLocaleLowerCase().includes(query) ||
          group.name.toLocaleLowerCase().includes(query) ||
          accountText.includes(query)
        )
      }),
    }))
    .filter((group) => group.categories.length > 0)
})
const nearLimitCount = computed(() => {
  if (!alertSettings.value?.budget_threshold_enabled || !monthBudget.value) return 0
  return monthBudget.value.groups
    .filter((group) => group.kind === 'expense')
    .flatMap((group) => group.categories)
    .filter((line) => {
      if (line.amount === null) return false
      const used =
        line.period === 'yearly' && line.year_to_date !== null
          ? toCents(line.year_to_date)
          : toCents(line.actual)
      const limit =
        line.period === 'yearly'
          ? toCents(line.amount)
          : toCents(line.budgeted) + toCents(line.carried)
      return limit > 0 && (used / limit) * 100 >= alertThreshold.value
    }).length
})

async function load() {
  const current = ++request
  loading.value = true
  error.value = null
  try {
    const month = await fetchBudgetMonth(selectedMonth.value)
    const [year, configs] = await Promise.all([
      fetchBudgetYear(month.year),
      fetchBudgetConfigurations(selectedMonth.value),
    ])
    if (current === request) {
      monthBudget.value = month
      budgetYear.value = year
      configurations.value = configs
      loaded.value = true
    }
  } catch (loadError) {
    if (current === request) error.value = errorMessage(loadError)
  } finally {
    if (current === request) loading.value = false
  }
}

onMounted(() => {
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  if (!preferences.saved) void preferences.load()
  void load()
})

watch(selectedMonth, () => {
  void load()
})

function moveMonth(offset: number) {
  const month = monthOffset(selectedMonth.value, offset)
  if (isBudgetMonth(month)) selectedMonth.value = month
}

function openEditor(line: BudgetLine, kind: CategoryKind) {
  const configuration = configFor(line.category_id)
  editing.value = { line, kind }
  form.period = configuration?.period ?? line.period ?? 'monthly'
  form.amount = configuration?.amount ?? line.amount
  form.scope = 'onward'
  form.rollover = configuration?.rollover ?? false
  form.cycleAnchor = configuration?.cycle_anchor ?? monthStart(selectedMonth.value)
  form.accountIds = [...(configuration?.account_ids ?? [])]
  budgetDialog.value = true
}

async function saveBudget() {
  if (!editing.value) return
  if (budgetForm.value && !(await budgetForm.value.validate()).valid) return
  saving.value = true
  try {
    await saveCategoryBudget(editing.value.line.category_id, {
      month: selectedMonth.value,
      period: form.period,
      amount: form.amount,
      scope: form.scope,
      rollover: form.period === 'monthly' && form.rollover,
      cycle_anchor:
        form.period === 'weekly' || form.period === 'biweekly'
          ? form.cycleAnchor || monthStart(selectedMonth.value)
          : null,
      account_ids: form.accountIds,
    })
    notify(form.amount === null ? 'Stopped this budget from the selected month' : 'Budget saved')
    budgetDialog.value = false
    await load()
  } catch (saveError) {
    notify(`Couldn't save the budget. ${errorMessage(saveError)}`, 'error')
  } finally {
    saving.value = false
  }
}

async function removeBudget() {
  if (!editing.value) return
  const category = editing.value.line
  const confirmed = await confirmAndRun(
    {
      title: `Delete ${category.name}'s budget?`,
      text: 'This removes its complete budget history and transaction links. Transactions stay in your history.',
      confirmText: 'Delete budget',
      tone: 'error',
      icon: Trash2,
    },
    () => deleteCategoryBudget(category.category_id),
  )
  if (!confirmed) return
  budgetDialog.value = false
  notify(`Deleted ${category.name}'s budget`)
  await load()
}

async function loadLinkableTransactions() {
  if (!linkedCategory.value) return
  const target = linkedCategory.value
  const current = ++transactionRequest
  transactionLoading.value = true
  transactionError.value = null
  try {
    const result = await fetchTransactions({
      start: monthStart(selectedMonth.value),
      end: monthEnd(selectedMonth.value),
      direction: target.kind === 'income' ? 'in' : 'out',
      page_size: 100,
      sort: '-date',
    })
    if (current === transactionRequest) linkableTransactions.value = result.items
  } catch (loadError) {
    if (current === transactionRequest) transactionError.value = errorMessage(loadError)
  } finally {
    if (current === transactionRequest) transactionLoading.value = false
  }
}

function openTransactionLinks(line: BudgetLine, kind: CategoryKind) {
  linkedCategory.value = { id: line.category_id, name: line.name, kind }
  transactionDialog.value = true
  void loadLinkableTransactions()
}

function transactionLink(transactionId: string): BudgetConfiguration | undefined {
  return configurations.value.find((configuration) =>
    configuration.linked_transaction_ids.includes(transactionId),
  )
}

async function toggleTransactionLink(transaction: Transaction) {
  if (!linkedCategory.value) return
  const target = linkedCategory.value
  const linked = transactionLink(transaction.id)?.category_id === target.id
  transactionAction.value = transaction.id
  try {
    if (linked) {
      await unlinkBudgetTransaction(target.id, transaction.id)
      notify('Removed the transaction from this budget')
    } else {
      await linkBudgetTransaction(target.id, transaction.id)
      notify('Linked the transaction to this budget')
    }
    await load()
    await loadLinkableTransactions()
  } catch (linkError) {
    notify(`Couldn't update the transaction link. ${errorMessage(linkError)}`, 'error')
  } finally {
    transactionAction.value = null
  }
}

function subscriptionLink(subscriptionId: string): BudgetConfiguration | undefined {
  return configurations.value.find((configuration) =>
    configuration.linked_subscription_ids.includes(subscriptionId),
  )
}

function subscriptionCanLink(subscription: Subscription): boolean {
  if (!subscriptionCategory.value) return false
  const scope = configFor(subscriptionCategory.value.id)?.account_ids ?? []
  const account = accounts.find(subscription.account_id)
  return (
    (!scope.length || scope.includes(subscription.account_id)) &&
    account?.currency === currency.value
  )
}

async function loadLinkableSubscriptions() {
  const current = ++subscriptionRequest
  subscriptionLoading.value = true
  subscriptionError.value = null
  try {
    const result = await fetchSubscriptions()
    if (current === subscriptionRequest) linkableSubscriptions.value = result
  } catch (loadError) {
    if (current === subscriptionRequest) subscriptionError.value = errorMessage(loadError)
  } finally {
    if (current === subscriptionRequest) subscriptionLoading.value = false
  }
}

function openSubscriptionLinks(line: BudgetLine) {
  subscriptionCategory.value = { id: line.category_id, name: line.name }
  subscriptionDialog.value = true
  void loadLinkableSubscriptions()
}

async function toggleSubscriptionLink(subscription: Subscription) {
  if (!subscriptionCategory.value) return
  const target = subscriptionCategory.value
  const linked = subscriptionLink(subscription.id)?.category_id === target.id
  subscriptionAction.value = subscription.id
  try {
    if (linked) {
      await unlinkBudgetSubscription(target.id, subscription.id)
      notify('Removed the subscription from this budget')
    } else {
      await linkBudgetSubscription(target.id, subscription.id)
      notify('Linked the subscription to this budget')
    }
    await load()
  } catch (linkError) {
    notify(`Couldn't update the subscription link. ${errorMessage(linkError)}`, 'error')
  } finally {
    subscriptionAction.value = null
  }
}

function transactionAccount(transaction: Transaction): string {
  return accounts.find(transaction.account_id)?.name ?? 'Account unavailable'
}

function usedAmount(line: BudgetLine): string {
  return line.period === 'yearly' ? (line.year_to_date ?? line.actual) : line.actual
}

function limitAmount(line: BudgetLine): string {
  if (line.period === 'yearly') return line.amount ?? '0.00'
  return fromCents(toCents(line.budgeted) + toCents(line.carried))
}

function transactionUsedLabel(kind: CategoryKind): string {
  return kind === 'income' ? 'Received' : 'Spent'
}

function accountScopeLabel(categoryId: string): string {
  const selected = configFor(categoryId)?.account_ids ?? []
  return selected.map((id) => accounts.find(id)?.name ?? 'Account unavailable').join(', ')
}
</script>

<template>
  <TabPage name="budget">
    <template v-if="auth.isAdmin" #actions>
      <v-menu location="bottom end" max-height="420">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            color="primary"
            variant="flat"
            :prepend-icon="Plus"
            data-test="budget-add"
          >
            Set a budget
          </v-btn>
        </template>
        <v-list>
          <template v-for="group in monthBudget?.groups ?? []" :key="group.id">
            <v-list-subheader>{{ group.name }}</v-list-subheader>
            <v-list-item
              v-for="line in group.categories"
              :key="line.category_id"
              :title="`${line.emoji} ${line.name}`"
              :subtitle="line.amount === null ? 'Set a budget' : 'Edit budget'"
              :data-test="`budget-menu-${line.category_id}`"
              @click="openEditor(line, group.kind)"
            />
          </template>
        </v-list>
      </v-menu>
    </template>

    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      text="You can see the household budget. Only an admin can change it."
    />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      title="Couldn't load the budget"
      :text="error"
      data-test="budget-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="budget-retry" @click="load">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-if="loading && !loaded" data-test="budget-loading">
      <v-skeleton-loader type="heading, paragraph, card@3" />
    </div>

    <v-card v-else-if="noCategories" rounded="xl" class="budget-empty" data-test="budget-empty">
      <EmptyState
        :icon="ChartPie"
        title="Give your money a plan"
        text="Set a target for any income or spending category, then track it against real transactions."
      >
        <v-btn
          v-if="auth.isAdmin"
          color="primary"
          variant="tonal"
          to="/settings/categories"
          data-test="budget-create-category"
        >
          Add budget categories
        </v-btn>
      </EmptyState>
    </v-card>

    <template v-else-if="loaded && monthBudget">
      <div class="budget-toolbar d-flex flex-wrap align-center justify-space-between ga-3 mb-5">
        <div class="d-flex align-center ga-2">
          <v-btn
            :icon="ArrowLeft"
            variant="text"
            aria-label="Previous month"
            data-test="budget-previous"
            @click="moveMonth(-1)"
          />
          <v-text-field
            v-model="monthField"
            type="month"
            :min="FIRST_MONTH"
            :max="LAST_MONTH"
            hide-details
            density="compact"
            variant="outlined"
            class="budget-month-picker"
            :aria-label="`Selected month: ${title}`"
            data-test="budget-month"
          />
          <v-btn
            :icon="ArrowRight"
            variant="text"
            aria-label="Next month"
            data-test="budget-next"
            @click="moveMonth(1)"
          />
          <v-btn
            variant="text"
            size="small"
            data-test="budget-current-month"
            @click="selectedMonth = todayIso().slice(0, 7)"
          >
            Today
          </v-btn>
        </div>
        <p class="text-body-small text-medium-emphasis ma-0" data-test="budget-year-range">
          Budget year {{ monthBudget.year }} · {{ monthBudget.year_start }}–{{
            monthBudget.year_end
          }}
        </p>
      </div>

      <v-alert
        v-if="nearLimitCount"
        color="warning"
        variant="tonal"
        :icon="CalendarClock"
        class="mb-5"
        data-test="budget-alert"
      >
        {{ nearLimitCount }}
        {{ nearLimitCount === 1 ? 'category is' : 'categories are' }} near or over its budget limit.
        Change the threshold in
        <RouterLink to="/settings/alerts" class="text-warning font-weight-bold">
          Alert settings
        </RouterLink>
        .
      </v-alert>

      <v-alert
        v-if="monthBudget.other_currencies.length"
        type="info"
        variant="tonal"
        class="mb-5"
        data-test="budget-currency-note"
      >
        Transactions from {{ monthBudget.other_currencies.join(', ') }} accounts aren't included in
        this {{ currency }} budget.
      </v-alert>

      <v-row class="mb-1" density="compact">
        <v-col cols="12" md="6">
          <v-card rounded="xl" class="budget-summary budget-summary--spending h-100">
            <v-card-text class="pa-5 pa-md-6">
              <div class="d-flex align-center ga-3 mb-4">
                <v-avatar color="primary" variant="tonal" rounded="lg">
                  <v-icon :icon="ChartPie" />
                </v-avatar>
                <div>
                  <p class="text-title-medium font-weight-bold ma-0">Spending plan</p>
                  <p class="text-body-small text-medium-emphasis ma-0">{{ title }}</p>
                </div>
              </div>
              <BudgetProgress
                label="Spent so far"
                :used="monthBudget.spending.actual"
                :limit="spendingLimit"
                :currency="currency"
                used-label="Spent"
                target-label="available"
                :threshold-percent="enabledAlertThreshold"
              />
              <p
                v-if="toCents(selectedCarried) !== 0"
                class="text-body-small text-medium-emphasis mt-3 mb-0"
                data-test="budget-rollover-total"
              >
                Includes {{ formatMoney(selectedCarried, currency) }} carried from earlier months.
              </p>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="6">
          <v-card rounded="xl" class="budget-summary budget-summary--income h-100">
            <v-card-text class="pa-5 pa-md-6">
              <div class="d-flex align-center ga-3 mb-4">
                <v-avatar color="success" variant="tonal" rounded="lg">
                  <v-icon :icon="Link" />
                </v-avatar>
                <div>
                  <p class="text-title-medium font-weight-bold ma-0">Income plan</p>
                  <p class="text-body-small text-medium-emphasis ma-0">
                    Paychecks count when categorized or linked to an income budget.
                  </p>
                </div>
              </div>
              <BudgetProgress
                label="Income received"
                :used="receivedIncome"
                :limit="budgetedIncome"
                :currency="currency"
                used-label="Received"
                target-label="planned"
                :threshold-percent="enabledAlertThreshold"
              />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-card rounded="xl" class="budget-chart-card my-5">
        <v-card-text class="pa-5 pa-md-6">
          <div class="d-flex flex-wrap justify-space-between align-end ga-3 mb-4">
            <div>
              <p class="text-title-medium font-weight-bold ma-0">Your year at a glance</p>
              <p class="text-body-small text-medium-emphasis ma-0">
                Monthly spending against the targets you set.
              </p>
            </div>
            <span class="text-label-large text-medium-emphasis"
              >Budget year {{ budgetYear?.year }}</span
            >
          </div>
          <BudgetYearChart
            v-if="budgetYear"
            :budget-year="budgetYear"
            :selected-month="selectedMonth"
          />
        </v-card-text>
      </v-card>

      <div class="d-flex flex-column flex-sm-row align-stretch align-sm-center ga-3 mb-4">
        <v-text-field
          v-model="search"
          :prepend-inner-icon="Search"
          label="Search budgets and categories"
          density="comfortable"
          variant="outlined"
          hide-details
          clearable
          class="budget-search"
          data-test="budget-search"
        />
      </div>

      <v-alert
        v-if="unbudgeted"
        type="info"
        variant="tonal"
        class="mb-4"
        data-test="budget-no-targets"
      >
        No category targets are set yet. Choose a category below to create your household budget.
      </v-alert>

      <div v-if="visibleGroups.length" class="budget-groups">
        <section
          v-for="group in visibleGroups"
          :key="group.id"
          class="mb-6"
          :data-test="`budget-group-${group.kind}`"
        >
          <div class="d-flex align-center justify-space-between mb-3">
            <div>
              <h2 class="text-title-large font-weight-bold ma-0">{{ group.name }}</h2>
              <p class="text-body-small text-medium-emphasis ma-0">
                {{ group.kind === 'income' ? 'Money coming in' : 'Money going out' }}
              </p>
            </div>
            <v-chip
              :color="group.kind === 'income' ? 'success' : 'primary'"
              variant="tonal"
              size="small"
            >
              {{ group.categories.length }}
              {{ group.categories.length === 1 ? 'category' : 'categories' }}
            </v-chip>
          </div>

          <v-row density="compact">
            <v-col v-for="line in group.categories" :key="line.category_id" cols="12" md="6" xl="4">
              <v-card
                rounded="xl"
                class="budget-category h-100"
                :data-test="`budget-category-${line.category_id}`"
              >
                <v-card-text class="pa-4 pa-md-5">
                  <div class="d-flex align-start ga-3 mb-4">
                    <span class="budget-category__emoji" aria-hidden="true">{{ line.emoji }}</span>
                    <div class="flex-grow-1" style="min-width: 0">
                      <p
                        class="text-title-medium font-weight-bold text-truncate ma-0"
                        data-test="budget-category-name"
                      >
                        {{ line.name }}
                      </p>
                      <p
                        v-if="line.period && line.amount !== null"
                        class="text-body-small text-medium-emphasis ma-0"
                        data-test="budget-category-period"
                      >
                        {{ periodLabel(line.period) }}
                        <template v-if="line.rollover"> · rollover on</template>
                      </p>
                      <p v-else class="text-body-small text-medium-emphasis ma-0">No target set</p>
                    </div>
                    <v-btn
                      v-if="auth.isAdmin"
                      :icon="Plus"
                      variant="tonal"
                      color="primary"
                      size="small"
                      :aria-label="`${line.amount === null ? 'Set' : 'Edit'} ${line.name} budget`"
                      :data-test="`budget-edit-${line.category_id}`"
                      @click="openEditor(line, group.kind)"
                    />
                  </div>

                  <BudgetProgress
                    v-if="line.period && line.amount !== null"
                    label="Progress"
                    :used="usedAmount(line)"
                    :limit="limitAmount(line)"
                    :currency="currency"
                    :used-label="transactionUsedLabel(group.kind)"
                    :target-label="line.period === 'yearly' ? 'yearly target' : 'available'"
                    :threshold-percent="enabledAlertThreshold"
                  />
                  <div v-else class="budget-category__actual">
                    <span class="text-body-small text-medium-emphasis">
                      {{ transactionUsedLabel(group.kind) }}
                    </span>
                    <span class="text-title-medium font-weight-bold tabular-nums">
                      {{ formatMoney(line.actual, currency) }}
                    </span>
                  </div>

                  <div
                    v-if="configFor(line.category_id)?.account_ids.length"
                    class="d-flex align-center ga-2 mt-3 text-body-small text-medium-emphasis"
                    data-test="budget-account-scope"
                  >
                    <v-icon :icon="Wallet" size="16" />
                    <span class="text-truncate"
                      >Only {{ accountScopeLabel(line.category_id) }}</span
                    >
                  </div>
                  <p
                    v-if="configFor(line.category_id)?.linked_transaction_ids.length"
                    class="text-body-small text-success mt-3 mb-0"
                    data-test="budget-linked-count"
                  >
                    {{ configFor(line.category_id)?.linked_transaction_ids.length }}
                    {{ group.kind === 'income' ? 'paycheck' : 'bill or spending' }}
                    {{
                      configFor(line.category_id)?.linked_transaction_ids.length === 1
                        ? 'transaction'
                        : 'transactions'
                    }}
                    linked this month
                  </p>
                  <p
                    v-if="configFor(line.category_id)?.linked_subscription_ids.length"
                    class="text-body-small text-primary mt-2 mb-0"
                    data-test="budget-subscription-count"
                  >
                    {{ configFor(line.category_id)?.linked_subscription_ids.length }}
                    {{
                      configFor(line.category_id)?.linked_subscription_ids.length === 1
                        ? 'recurring bill'
                        : 'recurring bills'
                    }}
                    linked
                  </p>
                  <div v-if="auth.isAdmin && line.amount !== null" class="d-flex justify-end mt-3">
                    <div class="d-flex flex-wrap justify-end ga-1">
                      <v-btn
                        variant="text"
                        size="small"
                        :prepend-icon="Link"
                        :data-test="`budget-link-${group.kind}-${line.category_id}`"
                        @click="openTransactionLinks(line, group.kind)"
                      >
                        {{ group.kind === 'income' ? 'Link income' : 'Link payments' }}
                      </v-btn>
                      <v-btn
                        v-if="group.kind === 'expense'"
                        variant="text"
                        size="small"
                        :prepend-icon="CalendarClock"
                        :data-test="`budget-link-bills-${line.category_id}`"
                        @click="openSubscriptionLinks(line)"
                      >
                        Link bills
                      </v-btn>
                    </div>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </section>
      </div>

      <div v-else-if="search.trim()" class="budget-no-results" data-test="budget-no-results">
        <EmptyState
          :icon="Search"
          title="No matching categories"
          text="Try a different category name, group or account."
          compact
        />
      </div>
    </template>

    <AppDialog
      v-model="budgetDialog"
      :title="
        editing
          ? `${editing.line.amount === null ? 'Set' : 'Edit'} ${editing.line.name} budget`
          : 'Set a budget'
      "
      :subtitle="`Set a target for ${title}. Leave the amount blank to stop this budget from this month onward.`"
      :icon="ChartPie"
      fullscreen-on-mobile
      :persistent="saving"
      max-width="580"
      data-test="budget-editor"
    >
      <v-form ref="budgetForm" @submit.prevent="saveBudget">
        <div class="d-flex align-center ga-3 mb-4">
          <span class="budget-category__emoji" aria-hidden="true">
            {{ editing?.line.emoji }}
          </span>
          <div>
            <p class="text-title-medium font-weight-bold ma-0">{{ editing?.line.name }}</p>
            <p class="text-body-small text-medium-emphasis ma-0">
              {{ editing?.kind === 'income' ? 'Income target' : 'Spending target' }}
            </p>
          </div>
        </div>

        <MoneyField v-model="form.amount" label="Target amount" :currency="currency" />

        <v-select
          v-model="form.period"
          :items="periods"
          label="Budget frequency"
          data-test="budget-period"
        />
        <v-text-field
          v-if="form.period === 'weekly' || form.period === 'biweekly'"
          v-model="form.cycleAnchor"
          type="date"
          label="First cycle date"
          hint="Weekly or biweekly periods repeat from this date."
          persistent-hint
          data-test="budget-cycle-anchor"
        />
        <v-autocomplete
          v-model="form.accountIds"
          :items="accountItems"
          label="Accounts to include"
          multiple
          chips
          closable-chips
          clearable
          hint="Leave empty to include transactions from every account in your budget currency."
          persistent-hint
          data-test="budget-accounts"
        />
        <v-select
          v-model="form.scope"
          :items="scopeOptions"
          label="Apply changes"
          data-test="budget-scope"
        />
        <v-switch
          v-if="editing?.kind === 'expense' && form.period === 'monthly'"
          v-model="form.rollover"
          color="primary"
          label="Carry unused budget into the next month"
          hide-details
          data-test="budget-rollover"
        />
      </v-form>

      <template #actions>
        <v-btn
          v-if="editing?.line.amount !== null && editing"
          color="error"
          variant="text"
          class="me-auto"
          data-test="budget-delete"
          @click="removeBudget"
        >
          Delete budget
        </v-btn>
        <v-btn
          variant="text"
          :disabled="saving"
          data-test="budget-cancel"
          @click="budgetDialog = false"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          data-test="budget-save"
          @click="saveBudget"
        >
          Save budget
        </v-btn>
      </template>
    </AppDialog>

    <AppDialog
      v-model="transactionDialog"
      :title="`Link ${linkedCategory?.kind === 'income' ? 'income' : 'payments'} to ${linkedCategory?.name ?? 'budget'}`"
      :subtitle="
        linkedCategory?.kind === 'income'
          ? 'Choose paycheck transactions to count toward this income target. Linking does not change their category.'
          : 'Choose bill or spending transactions to count toward this target. Linking does not change their category.'
      "
      :icon="Link"
      fullscreen-on-mobile
      max-width="620"
      data-test="budget-transactions-dialog"
    >
      <v-alert
        v-if="transactionError"
        type="error"
        variant="tonal"
        class="mb-4"
        data-test="budget-transactions-error"
      >
        {{ transactionError }}
        <v-btn
          variant="text"
          size="small"
          data-test="budget-transactions-retry"
          @click="loadLinkableTransactions"
        >
          Try again
        </v-btn>
      </v-alert>
      <div v-if="transactionLoading" data-test="budget-transactions-loading">
        <v-skeleton-loader type="list-item@3" />
      </div>
      <EmptyState
        v-else-if="!linkableTransactions.length && !transactionError"
        :icon="CalendarClock"
        :title="`No ${linkedCategory?.kind === 'income' ? 'income' : 'payments'} this month yet`"
        :text="`Matching ${linkedCategory?.kind === 'income' ? 'incoming' : 'outgoing'} transactions will appear here.`"
        compact
      />
      <v-list v-else lines="two" class="pa-0">
        <v-list-item
          v-for="transaction in linkableTransactions"
          :key="transaction.id"
          :title="transaction.payee"
          :subtitle="`${transaction.date} · ${transactionAccount(transaction)}`"
          :data-test="`budget-transaction-${transaction.id}`"
        >
          <template #append>
            <div class="d-flex align-center ga-2">
              <span
                class="text-body-small font-weight-medium"
                :class="linkedCategory?.kind === 'income' ? 'text-success' : 'text-error'"
              >
                {{ formatMoney(transaction.amount, currency) }}
              </span>
              <v-btn
                v-if="transactionLink(transaction.id)?.category_id === linkedCategory?.id"
                variant="tonal"
                size="small"
                :loading="transactionAction === transaction.id"
                :data-test="`budget-unlink-${transaction.id}`"
                @click="toggleTransactionLink(transaction)"
              >
                Linked
              </v-btn>
              <v-btn
                v-else-if="transactionLink(transaction.id)"
                variant="text"
                size="small"
                disabled
                :aria-label="`${transaction.payee} is linked to another budget`"
              >
                Linked elsewhere
              </v-btn>
              <v-btn
                v-else
                variant="tonal"
                color="primary"
                size="small"
                :loading="transactionAction === transaction.id"
                :data-test="`budget-link-${transaction.id}`"
                @click="toggleTransactionLink(transaction)"
              >
                Link
              </v-btn>
            </div>
          </template>
        </v-list-item>
      </v-list>

      <template #actions>
        <v-btn
          variant="text"
          data-test="budget-transactions-done"
          @click="transactionDialog = false"
        >
          Done
        </v-btn>
      </template>
    </AppDialog>

    <AppDialog
      v-model="subscriptionDialog"
      :title="`Link bills to ${subscriptionCategory?.name ?? 'budget'}`"
      subtitle="Recurring bills stay in Subscriptions. Their matched payments count toward this budget without changing their category."
      :icon="CalendarClock"
      fullscreen-on-mobile
      max-width="620"
      data-test="budget-subscriptions-dialog"
    >
      <v-alert
        v-if="subscriptionError"
        type="error"
        variant="tonal"
        class="mb-4"
        data-test="budget-subscriptions-error"
      >
        {{ subscriptionError }}
        <v-btn
          variant="text"
          size="small"
          data-test="budget-subscriptions-retry"
          @click="loadLinkableSubscriptions"
        >
          Try again
        </v-btn>
      </v-alert>
      <div v-if="subscriptionLoading" data-test="budget-subscriptions-loading">
        <v-skeleton-loader type="list-item@3" />
      </div>
      <EmptyState
        v-else-if="!linkableSubscriptions.length && !subscriptionError"
        :icon="CalendarClock"
        title="No subscriptions to link"
        text="Add a recurring bill in Subscriptions first, then link it to this budget."
        compact
      >
        <v-btn to="/subscriptions" variant="tonal">Open subscriptions</v-btn>
      </EmptyState>
      <v-list v-else lines="two" class="pa-0">
        <v-list-item
          v-for="subscription in linkableSubscriptions"
          :key="subscription.id"
          :title="subscription.name"
          :subtitle="`${subscription.frequency} · ${subscription.next_due_date} · ${accounts.find(subscription.account_id)?.name ?? 'Account unavailable'}`"
          :data-test="`budget-subscription-${subscription.id}`"
        >
          <template #append>
            <div class="d-flex align-center ga-2">
              <span class="text-body-small text-error font-weight-medium">
                {{
                  formatMoney(
                    subscription.amount,
                    accounts.find(subscription.account_id)?.currency ?? currency,
                  )
                }}
              </span>
              <v-btn
                v-if="subscriptionLink(subscription.id)?.category_id === subscriptionCategory?.id"
                variant="tonal"
                size="small"
                :loading="subscriptionAction === subscription.id"
                :data-test="`budget-unlink-subscription-${subscription.id}`"
                @click="toggleSubscriptionLink(subscription)"
              >
                Linked
              </v-btn>
              <v-btn
                v-else-if="subscriptionLink(subscription.id)"
                variant="text"
                size="small"
                disabled
                :aria-label="`${subscription.name} is linked to another budget`"
              >
                Linked elsewhere
              </v-btn>
              <v-btn
                v-else
                variant="tonal"
                color="primary"
                size="small"
                :disabled="!subscriptionCanLink(subscription)"
                :loading="subscriptionAction === subscription.id"
                :data-test="`budget-link-subscription-${subscription.id}`"
                @click="toggleSubscriptionLink(subscription)"
              >
                Link
              </v-btn>
            </div>
          </template>
        </v-list-item>
      </v-list>

      <template #actions>
        <v-btn
          variant="text"
          data-test="budget-subscriptions-done"
          @click="subscriptionDialog = false"
        >
          Done
        </v-btn>
      </template>
    </AppDialog>
  </TabPage>
</template>

<style scoped>
.budget-summary,
.budget-chart-card,
.budget-category,
.budget-empty,
.budget-no-results {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.budget-summary--spending {
  background:
    radial-gradient(ellipse at top right, rgba(var(--v-theme-primary), 0.1), transparent 58%),
    rgb(var(--v-theme-surface));
}

.budget-summary--income {
  background:
    radial-gradient(ellipse at top right, rgba(var(--v-theme-success), 0.1), transparent 58%),
    rgb(var(--v-theme-surface));
}

.budget-category {
  transition:
    transform 150ms ease,
    box-shadow 150ms ease;
}

.budget-category:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 30px -18px rgba(0, 0, 0, 0.35);
}

.budget-category__emoji {
  display: grid;
  flex: 0 0 42px;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.09);
  font-size: 22px;
}

.budget-category__actual {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-radius: 12px;
  padding: 12px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}

.budget-month-picker {
  width: 170px;
}

.budget-search {
  max-width: 480px;
}

.budget-no-results {
  border-radius: 20px;
}

@media (max-width: 599px) {
  .budget-toolbar {
    align-items: flex-start !important;
  }

  .budget-month-picker {
    width: 145px;
  }

  .budget-search {
    max-width: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .budget-category {
    transition: none;
  }

  .budget-category:hover {
    transform: none;
  }
}
</style>
