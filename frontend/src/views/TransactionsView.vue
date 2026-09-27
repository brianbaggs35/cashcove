<script setup lang="ts">
import { ArrowLeftRight, FileUp, Landmark, Plug, Plus, SearchX, Trash2 } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'

import { errorMessage } from '@/api/client'
import {
  deleteTransactions,
  fetchTransactions,
  type Transaction,
  type TransactionPage,
} from '@/api/transactions'
import TabPage from '@/components/TabPage.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import type { PeriodKey } from '@/utils/dates'
import BulkBar from '@/views/transactions/BulkBar.vue'
import CategorizeDialog from '@/views/transactions/CategorizeDialog.vue'
import FilterChips from '@/views/transactions/FilterChips.vue'
import FilterDialog from '@/views/transactions/FilterDialog.vue'
import TotalsBar from '@/views/transactions/TotalsBar.vue'
import TransactionDialog from '@/views/transactions/TransactionDialog.vue'
import TransactionList from '@/views/transactions/TransactionList.vue'
import TransactionTable from '@/views/transactions/TransactionTable.vue'
import TransactionToolbar from '@/views/transactions/TransactionToolbar.vue'
import {
  apiQuery,
  filterCount,
  isFiltered,
  useTransactionView,
  type TransactionFilters,
} from '@/views/transactions/view'

const auth = useAuthStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const { mdAndUp } = useDisplay()
const { view, update, filter, clear } = useTransactionView()

const result = ref<TransactionPage | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let latest = 0

/** Loads the page being shown; only the latest request gets to show its answer. */
async function load() {
  const request = ++latest
  loading.value = true
  error.value = null
  try {
    const page = await fetchTransactions(apiQuery(view.value))
    if (request !== latest) return
    // Past the last page, e.g. after deleting its last transactions: show the last one instead.
    if (!page.items.length && page.total > 0 && view.value.page > 1) {
      update({ page: Math.ceil(page.total / view.value.pageSize) })
      return
    }
    result.value = page
  } catch (caught) {
    if (request === latest) error.value = errorMessage(caught)
  } finally {
    if (request === latest) loading.value = false
  }
}

onMounted(() => {
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  void load()
})

const selected = ref<string[]>([])
watch(view, () => {
  selected.value = []
  void load()
})

/** Something changed: the list and the balances it moved both need a fresh look. */
function changed() {
  selected.value = []
  void load()
  void accounts.load()
}

const filtered = computed(() => isFiltered(view.value.filters))
/** There are no transactions at all yet, rather than none that match. */
const empty = computed(() => result.value?.total === 0 && !filtered.value)
const canAdd = computed(() => auth.isAdmin && accounts.manual.length > 0)

const emptyText = computed(() => {
  if (!auth.isAdmin) return "An admin hasn't added any transactions yet."
  if (!accounts.open.length) {
    return 'Transactions go in accounts, so add an account or connect a bank first.'
  }
  if (!canAdd.value) return 'Transactions from your linked accounts show up here once they sync.'
  return 'Add them by hand, import them from a file, or connect a bank to bring them in.'
})
const pageCount = computed(() =>
  result.value ? Math.max(1, Math.ceil(result.value.total / view.value.pageSize)) : 1,
)

// Adding and editing a transaction.
const dialog = ref(false)
const editing = ref<Transaction | null>(null)

/** A new transaction goes to the account being looked at, when that's one kept by hand. */
const defaultAccount = computed(() => {
  const [only, ...others] = view.value.filters.accounts
  return only && !others.length && accounts.manual.some((account) => account.id === only)
    ? only
    : null
})

function add() {
  editing.value = null
  dialog.value = true
}

function openTransaction(transaction: Transaction) {
  editing.value = transaction
  dialog.value = true
}

// Filters.
const filtersOpen = ref(false)
const filtersFocus = ref<'dates' | null>(null)

function showFilters(focus?: 'dates') {
  filtersFocus.value = focus ?? null
  filtersOpen.value = true
}

function applyFilters(filters: TransactionFilters) {
  filter(filters)
}

function choosePeriod(period: PeriodKey) {
  filter({ period, start: null, end: null })
}

// Acting on several at once.
const categorizing = ref(false)

async function removeSelected() {
  const count = selected.value.length
  const what = count === 1 ? '1 transaction' : `${count} transactions`
  const done = await confirmAndRun(
    {
      title: `Delete ${what}?`,
      text: "Balances of accounts kept by hand move back by their amounts. This can't be undone.",
      confirmText: count === 1 ? 'Delete transaction' : 'Delete transactions',
      tone: 'error',
      icon: Trash2,
    },
    () => deleteTransactions(selected.value),
  )
  if (!done) return
  const deleted = done.result.count
  notify(deleted === 1 ? 'Deleted 1 transaction' : `Deleted ${deleted} transactions`)
  changed()
}
</script>

<template>
  <TabPage name="transactions">
    <template v-if="canAdd && result && !empty" #actions>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Plus"
        data-test="transaction-add"
        @click="add"
      >
        Add transaction
      </v-btn>
    </template>

    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      text="You can see every transaction. Only an admin can add or change them."
    />

    <TransactionToolbar
      v-if="!empty"
      :filters="view.filters"
      :sort="view.sort"
      :filter-count="filterCount(view.filters)"
      @search="(q) => filter({ q })"
      @period="choosePeriod"
      @sort="(sort) => update({ sort })"
      @filters="showFilters"
    />

    <FilterChips :filters="view.filters" @change="filter" @clear="clear" />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="`Couldn't load the transactions. ${error}`"
      data-test="transactions-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="transactions-retry" @click="load">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-else-if="!result" data-test="transactions-loading">
      <v-skeleton-loader type="heading" class="mb-4 rounded-xl" />
      <v-skeleton-loader type="table-row@6" class="rounded-xl" />
    </div>

    <v-card v-else-if="!result.total && filtered" data-test="transactions-none-match">
      <EmptyState
        :icon="SearchX"
        title="No transactions match"
        text="Try another search, a longer period or fewer filters."
      >
        <v-btn variant="outlined" data-test="transactions-clear" @click="clear">
          Clear filters
        </v-btn>
      </EmptyState>
    </v-card>

    <v-card v-else-if="empty" data-test="transactions-empty">
      <EmptyState :icon="ArrowLeftRight" title="No transactions yet" :text="emptyText">
        <template v-if="auth.isAdmin">
          <v-btn
            v-if="canAdd"
            color="primary"
            variant="flat"
            :prepend-icon="Plus"
            data-test="transaction-add-first"
            @click="add"
          >
            Add a transaction
          </v-btn>
          <v-btn
            v-else-if="!accounts.open.length"
            color="primary"
            variant="flat"
            :prepend-icon="Landmark"
            to="/accounts"
            data-test="transactions-accounts"
          >
            Add an account
          </v-btn>
          <v-btn variant="outlined" :prepend-icon="FileUp" to="/import">Import a file</v-btn>
          <v-btn variant="outlined" :prepend-icon="Plug" to="/connect">Connect a bank</v-btn>
        </template>
      </EmptyState>
    </v-card>

    <template v-else>
      <TotalsBar :totals="result.totals" :total="result.total" />

      <v-card v-if="mdAndUp" class="overflow-hidden">
        <BulkBar
          v-if="selected.length"
          :count="selected.length"
          @categorize="categorizing = true"
          @delete="removeSelected"
          @clear="selected = []"
        />
        <TransactionTable
          v-model:selected="selected"
          :items="result.items"
          :total="result.total"
          :loading="loading"
          :sort="view.sort"
          :page="view.page"
          :page-size="view.pageSize"
          :selectable="auth.isAdmin"
          @open="openTransaction"
          @options="update"
        />
      </v-card>

      <v-card v-else class="overflow-hidden">
        <v-progress-linear v-if="loading" indeterminate color="primary" height="2" absolute />
        <TransactionList
          :items="result.items"
          :by-day="view.sort.endsWith('date')"
          @open="openTransaction"
        />
        <v-pagination
          v-if="pageCount > 1"
          :model-value="view.page"
          :length="pageCount"
          :total-visible="5"
          density="comfortable"
          class="py-2"
          data-test="transaction-pages"
          @update:model-value="(page: number) => update({ page })"
        />
      </v-card>
    </template>

    <FilterDialog
      v-model="filtersOpen"
      :filters="view.filters"
      :focus="filtersFocus"
      @apply="applyFilters"
    />
    <TransactionDialog
      v-model="dialog"
      :transaction="editing"
      :default-account="defaultAccount"
      :readonly="!auth.isAdmin"
      @saved="changed"
      @deleted="changed"
    />
    <CategorizeDialog v-if="auth.isAdmin" v-model="categorizing" :ids="selected" @done="changed" />
  </TabPage>
</template>
