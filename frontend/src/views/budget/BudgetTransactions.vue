<script setup lang="ts">
import { ArrowDownToLine, ArrowUpFromLine, SearchX, Undo2, Unlink } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'

import {
  fetchBudgetTransactions,
  linkBudgetTransactions,
  unlinkBudgetTransaction,
  type BudgetSource,
  type BudgetTransaction,
} from '@/api/budget'
import { errorMessage } from '@/api/client'
import EmptyState from '@/components/ui/EmptyState.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { fromIsoDate, todayIso } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'

/**
 * The transactions that count toward the budget in a period, and why each does. Admins can take
 * any of them off, even when a whole account or category counts them, and put them back.
 */
const props = defineProps<{
  budgetId: string
  budgetName: string
  /** Any day in the period. */
  on: string
  /** The budget's sources, which say what counts the ones that aren't linked themselves. */
  sources: BudgetSource[]
  /** How many were taken off in this period. */
  removed: number
  readonly: boolean
  /** Changes when something else changed what counts, so the list loads again. */
  version: number
}>()
const emit = defineEmits<{ changed: [] }>()

const PAGE_SIZE = 10

type Filter = 'all' | 'income' | 'spending' | 'removed'

const { locale } = useHousehold()
const accounts = useAccountsStore()
const categories = useCategoriesStore()

const filter = ref<Filter>('all')
const page = ref(1)
const items = ref<BudgetTransaction[]>([])
const total = ref(0)
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
let latest = 0

async function load() {
  const request = ++latest
  loading.value = true
  error.value = null
  try {
    const result = await fetchBudgetTransactions(props.budgetId, {
      on: props.on,
      today: todayIso(),
      kind: filter.value === 'income' || filter.value === 'spending' ? filter.value : undefined,
      removed: filter.value === 'removed' ? true : undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    if (request !== latest) return
    // Past the last page, e.g. after taking off the last one on it: show the last one instead.
    if (!result.items.length && result.total > 0 && page.value > 1) {
      page.value = Math.ceil(result.total / PAGE_SIZE)
      return
    }
    items.value = result.items
    total.value = result.total
    loaded.value = true
  } catch (loadError) {
    if (request === latest) error.value = errorMessage(loadError)
  } finally {
    if (request === latest) loading.value = false
  }
}

onMounted(() => {
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  void load()
})
watch([() => props.budgetId, () => props.on, filter], () => {
  page.value = 1
  void load()
})
watch([page, () => props.version], () => void load())

const problem = computed(() =>
  error.value ? `Couldn't load the transactions. ${error.value}` : changing.error.value,
)

const filters = computed(() => [
  { value: 'all', title: 'All' },
  { value: 'income', title: 'Income' },
  { value: 'spending', title: 'Spending' },
  { value: 'removed', title: props.removed ? `Taken off (${props.removed})` : 'Taken off' },
])
const empty = computed(
  () =>
    ({
      all: 'Nothing counts toward this budget in this period yet.',
      income: 'No income counts in this period.',
      spending: 'No spending counts in this period.',
      removed: 'Nothing was taken off in this period.',
    })[filter.value],
)

function reason(item: BudgetTransaction): string {
  if (item.via === 'transaction') return 'Linked by hand'
  const source = props.sources.find((candidate) => candidate.id === item.source_id)
  const labels = {
    automation: ['Rule', 'A rule'],
    subscription: ['Subscription', 'A subscription'],
    bill: ['Bill', 'A bill'],
    category: ['Category', 'A category'],
    account: ['Account', 'An account'],
  } as const
  // A bill's payments are counted via the subscription link, and the source says which it is.
  const [prefix, fallback] = labels[source?.type ?? item.via]
  return source ? `${prefix}: ${source.name}` : fallback
}

function details(item: BudgetTransaction): string {
  return [
    formatShortDate(fromIsoDate(item.date), locale.value),
    accounts.find(item.account_id)?.name ?? 'Deleted account',
    categories.find(item.category_id)?.name ?? 'Uncategorized',
  ].join(' · ')
}

const changing = useAction(async (item: BudgetTransaction, putBack: boolean) => {
  if (putBack) {
    await linkBudgetTransactions(props.budgetId, [item.id], item.kind)
    notify(`Put ${item.payee} back on ${props.budgetName}`)
  } else {
    await unlinkBudgetTransaction(props.budgetId, item.id)
    notify(`Took ${item.payee} off ${props.budgetName}`)
  }
  emit('changed')
  await load()
})
</script>

<template>
  <v-card data-test="budget-transactions">
    <v-card-text class="pa-5">
      <div class="d-flex align-center flex-wrap ga-3 mb-3">
        <div class="flex-grow-1">
          <h3 class="text-title-medium font-weight-bold ma-0">Transactions that count</h3>
          <p class="text-body-small text-medium-emphasis ma-0">
            Each says why it counts. Take one off and it stops counting here, nowhere else.
          </p>
        </div>
        <v-btn-toggle
          v-model="filter"
          mandatory
          divided
          density="comfortable"
          variant="outlined"
          color="primary"
          aria-label="Which transactions to list"
          data-test="transactions-filter"
        >
          <v-btn
            v-for="option in filters"
            :key="option.value"
            :value="option.value"
            size="small"
            :data-test="`filter-${option.value}`"
          >
            {{ option.title }}
          </v-btn>
        </v-btn-toggle>
      </div>

      <v-alert
        v-if="problem"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        :text="problem"
        data-test="transactions-error"
      >
        <template v-if="error" #append>
          <v-btn variant="text" size="small" data-test="transactions-retry" @click="load">
            Try again
          </v-btn>
        </template>
      </v-alert>

      <v-skeleton-loader
        v-if="!loaded && !error"
        type="list-item-two-line@3"
        data-test="transactions-loading"
      />
      <EmptyState
        v-else-if="loaded && !items.length"
        :icon="SearchX"
        :title="empty"
        compact
        data-test="transactions-empty"
      />
      <v-list
        v-else-if="items.length"
        lines="two"
        class="pa-0"
        :class="{ 'opacity-60': loading }"
        data-test="transactions-list"
      >
        <v-list-item
          v-for="item in items"
          :key="item.id"
          class="px-0"
          data-test="budget-transaction"
        >
          <template #prepend>
            <v-avatar
              :color="item.kind === 'income' ? 'success' : undefined"
              variant="tonal"
              size="36"
              class="me-3"
            >
              <v-icon
                :icon="item.kind === 'income' ? ArrowDownToLine : ArrowUpFromLine"
                size="18"
              />
            </v-avatar>
          </template>
          <v-list-item-title class="d-flex align-center ga-3">
            <span
              class="font-weight-medium text-truncate flex-grow-1"
              data-test="transaction-payee"
            >
              {{ item.payee }}
            </span>
            <MoneyAmount
              :amount="item.amount"
              signed
              class="text-body-medium font-weight-bold flex-shrink-0"
            />
          </v-list-item-title>
          <v-list-item-subtitle>{{ details(item) }}</v-list-item-subtitle>
          <div class="mt-1 d-flex flex-wrap ga-1">
            <v-chip size="x-small" variant="tonal" data-test="transaction-kind">
              {{ item.kind === 'income' ? 'Counts as income' : 'Counts as spending' }}
            </v-chip>
            <v-chip size="x-small" variant="outlined" data-test="transaction-reason">
              {{ reason(item) }}
            </v-chip>
          </div>
          <template v-if="!readonly" #append>
            <v-btn
              v-if="filter === 'removed'"
              variant="text"
              size="small"
              color="primary"
              :prepend-icon="Undo2"
              :disabled="changing.busy.value"
              class="ms-2"
              data-test="put-back"
              @click="changing.run(item, true)"
            >
              Put back
            </v-btn>
            <v-btn
              v-else
              :icon="Unlink"
              variant="text"
              size="small"
              :aria-label="`Take ${item.payee} off ${budgetName}`"
              :title="`Take ${item.payee} off ${budgetName}`"
              :disabled="changing.busy.value"
              class="ms-2"
              data-test="take-off"
              @click="changing.run(item, false)"
            />
          </template>
        </v-list-item>
      </v-list>
      <v-pagination
        v-if="total > PAGE_SIZE"
        v-model="page"
        :length="Math.ceil(total / PAGE_SIZE)"
        :total-visible="5"
        density="comfortable"
        class="mt-2"
        data-test="transactions-pages"
      />
    </v-card-text>
  </v-card>
</template>
