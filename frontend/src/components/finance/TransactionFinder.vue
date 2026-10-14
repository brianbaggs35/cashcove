<script setup lang="ts">
import { Search, SearchX } from '@lucide/vue'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'

import { errorMessage } from '@/api/client'
import { fetchTransactions, type Transaction } from '@/api/transactions'
import EmptyState from '@/components/ui/EmptyState.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { formatListDate } from '@/utils/dates'

/**
 * Finds transactions to pick from: a search box over the newest ones, listed with what they
 * were, when and where. The parent decides what picking means with the `prepend` and `append`
 * slots, which get each transaction, and calls `reload` after something changed. A parent that
 * wants its own rows fills the `row` slot, which is given each transaction and how the list
 * describes it, and can start the search with something (`v-model:search`) and say what an empty
 * result means (`empty`), with a `hint` under the search box.
 */
const props = withDefaults(
  defineProps<{
    /** Only money out (payments) or only money in. */
    direction?: 'in' | 'out'
    /** Only transactions linked to this subscription. */
    subscriptionId?: string | null
    /** Everything but the transactions linked to this subscription. */
    notSubscriptionId?: string | null
    /** Offers a switch for transactions that have no category yet. */
    uncategorizedSwitch?: boolean
    /** How many to list; the search narrows them down. */
    pageSize?: number
    /** Something to add to a transaction's description, e.g. what it's linked to. */
    note?: (transaction: Transaction) => string | null
  }>(),
  {
    direction: undefined,
    subscriptionId: null,
    notSubscriptionId: null,
    uncategorizedSwitch: false,
    pageSize: 25,
    note: () => null,
  },
)

const accounts = useAccountsStore()
const categories = useCategoriesStore()
const { locale } = useHousehold()

/** What is searched for, which the parent can set or read, e.g. to start with a payee. */
const search = defineModel<string>('search', { default: '' })
const uncategorized = ref(false)
const items = ref<Transaction[]>([])
const total = ref(0)
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
let latest = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function load() {
  const request = ++latest
  loading.value = true
  error.value = null
  try {
    const page = await fetchTransactions({
      q: search.value.trim() || undefined,
      uncategorized: uncategorized.value || undefined,
      direction: props.direction,
      subscription_id: props.subscriptionId ?? undefined,
      not_subscription_id: props.notSubscriptionId ?? undefined,
      page_size: props.pageSize,
      sort: '-date',
    })
    if (request !== latest) return
    items.value = page.items
    total.value = page.total
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

/** Clearing the field says null. */
function typed(value: string | null) {
  search.value = value ?? ''
}

// Searching waits for a pause in typing, so each keystroke doesn't ask for a new list.
watch(search, () => {
  clearTimeout(timer)
  timer = setTimeout(() => void load(), 300)
})
watch(
  [uncategorized, () => props.direction, () => props.subscriptionId, () => props.notSubscriptionId],
  () => void load(),
)
onScopeDispose(() => {
  clearTimeout(timer)
})

defineExpose({ reload: load })

const hiddenCount = computed(() => Math.max(0, total.value - items.value.length))

function describe(transaction: Transaction): string {
  return [
    formatListDate(transaction.date, locale.value),
    accounts.find(transaction.account_id)?.name ?? 'Deleted account',
    categories.find(transaction.category_id)?.name ?? 'Uncategorized',
    props.note(transaction),
  ]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <div data-test="transaction-finder">
    <div class="d-flex flex-wrap align-center gc-4 mb-2">
      <v-text-field
        :model-value="search"
        :prepend-inner-icon="Search"
        label="Search payees, notes or amounts"
        type="search"
        hide-details
        clearable
        class="transaction-finder__search"
        data-test="finder-search"
        @update:model-value="typed"
      />
      <v-switch
        v-if="uncategorizedSwitch"
        v-model="uncategorized"
        label="Uncategorized only"
        color="primary"
        hide-details
        density="comfortable"
        data-test="finder-uncategorized"
      />
    </div>
    <div v-if="$slots.hint" class="mb-3" data-test="finder-hint"><slot name="hint" /></div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-2"
      :text="`Couldn't load the transactions. ${error}`"
      data-test="finder-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="finder-retry" @click="load">Try again</v-btn>
      </template>
    </v-alert>
    <div v-else-if="!loaded" data-test="finder-loading">
      <v-skeleton-loader type="list-item-two-line@3" />
    </div>
    <div v-else-if="!items.length" data-test="finder-empty">
      <slot name="empty">
        <EmptyState
          :icon="SearchX"
          title="No transactions found"
          text="Try a different search."
          compact
        />
      </slot>
    </div>
    <template v-else>
      <ul
        v-if="$slots.row"
        class="transaction-finder__rows pa-0 ma-0"
        :class="{ 'transaction-finder__list--loading': loading }"
        data-test="finder-list"
      >
        <li v-for="transaction in items" :key="transaction.id" data-test="finder-row">
          <slot name="row" :transaction="transaction" :description="describe(transaction)" />
        </li>
      </ul>
      <v-list
        v-else
        lines="two"
        class="pa-0 transaction-finder__list"
        :class="{ 'transaction-finder__list--loading': loading }"
        data-test="finder-list"
      >
        <v-list-item
          v-for="transaction in items"
          :key="transaction.id"
          :title="transaction.payee"
          :subtitle="describe(transaction)"
          class="px-2"
          data-test="finder-row"
        >
          <template v-if="$slots.prepend" #prepend>
            <slot name="prepend" :transaction="transaction" />
          </template>
          <template #append>
            <div class="d-flex align-center ga-2">
              <MoneyAmount
                :amount="transaction.amount"
                :currency="accounts.find(transaction.account_id)?.currency"
                signed
                class="text-body-medium font-weight-medium"
              />
              <slot name="append" :transaction="transaction" />
            </div>
          </template>
        </v-list-item>
      </v-list>
      <p
        v-if="hiddenCount"
        class="text-body-small text-medium-emphasis mt-2 mb-0"
        data-test="finder-more"
      >
        Showing the newest {{ items.length }} of {{ total.toLocaleString() }}. Search to narrow them
        down.
      </p>
    </template>
  </div>
</template>

<style scoped>
.transaction-finder__search {
  flex: 1 1 240px;
}

.transaction-finder__list,
.transaction-finder__rows {
  transition: opacity 120ms;
}

.transaction-finder__rows {
  display: grid;
  gap: 8px;
  list-style: none;
}

.transaction-finder__list--loading {
  opacity: 0.6;
}
</style>
