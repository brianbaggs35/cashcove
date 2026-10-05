<script setup lang="ts">
import { FileUp, Landmark, LayoutDashboard, Plug } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import { errorMessage } from '@/api/client'
import { fetchDashboard, type Dashboard } from '@/api/dashboard'
import { fetchTransactions, type Transaction } from '@/api/transactions'
import TabPage from '@/components/TabPage.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useBudgetsStore } from '@/stores/budgets'
import { useCategoriesStore } from '@/stores/categories'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { todayIso } from '@/utils/dates'
import NetWorthCard from '@/views/accounts/NetWorthCard.vue'
import AccountsGlance from '@/views/dashboard/AccountsGlance.vue'
import AttentionStrip from '@/views/dashboard/AttentionStrip.vue'
import BudgetProgress from '@/views/dashboard/BudgetProgress.vue'
import CashFlowChart from '@/views/dashboard/CashFlowChart.vue'
import ComingUp from '@/views/dashboard/ComingUp.vue'
import MonthSummary from '@/views/dashboard/MonthSummary.vue'
import RecentTransactions from '@/views/dashboard/RecentTransactions.vue'
import SpendingBreakdown from '@/views/dashboard/SpendingBreakdown.vue'
import { dueSoon } from '@/views/dashboard/summary'
import TopPayees from '@/views/dashboard/TopPayees.vue'

/** How many of the latest transactions are listed. */
const RECENT = 6

const auth = useAuthStore()
const accounts = useAccountsStore()
const budgets = useBudgetsStore()
const subscriptions = useSubscriptionsStore()
const categories = useCategoriesStore()
const { currency } = useHousehold()

const dashboard = ref<Dashboard | null>(null)
const recent = ref<Transaction[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    const [summary, page] = await Promise.all([
      fetchDashboard(todayIso()),
      fetchTransactions({ page_size: RECENT }),
    ])
    dashboard.value = summary
    recent.value = page.items
  } catch (loadError) {
    error.value = errorMessage(loadError)
  } finally {
    loading.value = false
  }
}

// Everything on it changes as transactions come in, so it always shows the latest.
onMounted(() => {
  void load()
  void accounts.load()
  void budgets.load()
  void subscriptions.load()
  void categories.ensureLoaded()
})

const due = computed(() => dueSoon(subscriptions.recurring, todayIso()))

/** Why there is nothing to show yet: the dashboard or the accounts under it couldn't be loaded. */
const failure = computed(() => {
  if (!dashboard.value && error.value) return error.value
  return accounts.loaded ? null : accounts.error
})

function retry() {
  void load()
  void accounts.load()
}
</script>

<template>
  <TabPage name="dashboard">
    <v-alert
      v-if="failure"
      type="error"
      variant="tonal"
      :text="`Couldn't load your dashboard. ${failure}`"
      data-test="dashboard-error"
    >
      <template #append>
        <v-btn
          variant="text"
          size="small"
          :loading="loading || accounts.loading"
          data-test="dashboard-retry"
          @click="retry()"
        >
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-else-if="!dashboard || !accounts.loaded" data-test="dashboard-loading">
      <v-row>
        <v-col cols="12" md="5">
          <v-skeleton-loader type="heading, text, text" class="rounded-xl" />
        </v-col>
        <v-col cols="12" md="7">
          <v-skeleton-loader type="heading, text, text" class="rounded-xl" />
        </v-col>
        <v-col cols="12">
          <v-skeleton-loader type="image" class="rounded-xl" />
        </v-col>
      </v-row>
    </div>

    <v-card v-else-if="!accounts.accounts.length" data-test="dashboard-welcome">
      <EmptyState
        :icon="LayoutDashboard"
        title="Your dashboard starts with an account"
        :text="
          auth.isAdmin
            ? 'Add an account, import a statement or connect a bank. Then this is where you see how you are doing.'
            : 'An admin hasn\'t added any accounts yet.'
        "
      >
        <template v-if="auth.isAdmin">
          <v-btn
            to="/accounts"
            color="primary"
            variant="flat"
            :prepend-icon="Landmark"
            data-test="dashboard-add-account"
          >
            Add an account
          </v-btn>
          <v-btn to="/import" variant="outlined" :prepend-icon="FileUp">Import a statement</v-btn>
          <v-btn to="/connect" variant="outlined" :prepend-icon="Plug">Connect a bank</v-btn>
        </template>
      </EmptyState>
    </v-card>

    <template v-else>
      <AttentionStrip :uncategorized="dashboard.uncategorized" />

      <v-alert
        v-if="dashboard.unavailable.length"
        type="warning"
        variant="tonal"
        density="compact"
        class="mb-6"
        data-test="dashboard-unavailable"
      >
        There's no exchange rate for {{ dashboard.unavailable.join(', ') }}, so those transactions
        aren't counted.
      </v-alert>

      <v-row>
        <v-col cols="12" md="5">
          <NetWorthCard :accounts="accounts.open" class="h-100">
            <AccountsGlance :accounts="accounts.open" />
          </NetWorthCard>
        </v-col>
        <v-col cols="12" md="7">
          <MonthSummary :dashboard="dashboard" />
        </v-col>
        <v-col cols="12" lg="7">
          <CashFlowChart :months="dashboard.months" />
        </v-col>
        <v-col cols="12" lg="5">
          <SpendingBreakdown :categories="dashboard.categories" />
        </v-col>
        <v-col cols="12" md="6">
          <BudgetProgress :budgets="budgets.budgets" />
        </v-col>
        <v-col cols="12" md="6">
          <ComingUp :items="due" />
        </v-col>
        <v-col cols="12" md="5">
          <TopPayees :payees="dashboard.payees" />
        </v-col>
        <v-col cols="12" md="7">
          <RecentTransactions :transactions="recent" />
        </v-col>
      </v-row>

      <p
        v-if="dashboard.converted.length"
        class="text-body-small text-medium-emphasis mt-4 mb-0"
        data-test="dashboard-converted"
      >
        Amounts in {{ dashboard.converted.join(', ') }} are converted to {{ currency }} at each
        day's exchange rate. Money moving between your own accounts isn't counted as income or
        spending.
      </p>
      <p v-else class="text-body-small text-medium-emphasis mt-4 mb-0">
        Money moving between your own accounts isn't counted as income or spending.
      </p>
    </template>
  </TabPage>
</template>
