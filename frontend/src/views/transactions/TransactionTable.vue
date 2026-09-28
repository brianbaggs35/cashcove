<script setup lang="ts">
import { Eye, Pencil } from '@lucide/vue'
import { ref, watch } from 'vue'

import type { Transaction, TransactionSort } from '@/api/transactions'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { vPartlyChecked } from '@/directives/partlyChecked'
import { useAccountsStore } from '@/stores/accounts'
import { formatListDate } from '@/utils/dates'
import { PAGE_SIZES } from '@/views/transactions/view'

/** The transactions as a table, for wider screens: sortable, paged, and selectable by admins. */
const props = defineProps<{
  items: Transaction[]
  total: number
  loading: boolean
  sort: TransactionSort
  page: number
  pageSize: number
  selectable: boolean
}>()
const selected = defineModel<string[]>('selected', { required: true })
const emit = defineEmits<{
  open: [transaction: Transaction]
  options: [changes: { page: number; pageSize: number; sort: TransactionSort }]
}>()

const accounts = useAccountsStore()
const { locale } = useHousehold()

const headers = [
  { title: 'Date', key: 'date', sortable: true, width: 112 },
  { title: 'Payee', key: 'payee', sortable: true },
  { title: 'Category', key: 'category', sortable: false },
  { title: 'Account', key: 'account', sortable: false },
  { title: 'Amount', key: 'amount', sortable: true, align: 'end' as const },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' as const, width: 64 },
]

const pageSizes = PAGE_SIZES.map((size) => ({ value: size, title: String(size) }))

interface SortItem {
  key: string
  order?: boolean | 'asc' | 'desc'
}

const toSortBy = (sort: TransactionSort): SortItem[] => [
  { key: sort.replace('-', ''), order: sort.startsWith('-') ? 'desc' : 'asc' },
]

// The table changes these as people page and sort, and the address follows; the address in
// turn sets them when it changes, e.g. going back.
const page = ref(props.page)
const itemsPerPage = ref(props.pageSize)
const sortBy = ref(toSortBy(props.sort))
watch(
  () => [props.page, props.pageSize, props.sort] as const,
  ([nextPage, nextSize, nextSort]) => {
    page.value = nextPage
    itemsPerPage.value = nextSize
    sortBy.value = toSortBy(nextSort)
  },
)

interface Options {
  page: number
  itemsPerPage: number
  sortBy: SortItem[]
}

/** The order the table's headers ask for, newest first when they ask for none. */
function sortOf([first]: SortItem[]): TransactionSort {
  if (!first) return '-date'
  const direction = first.order === 'desc' ? '-' : ''
  return `${direction}${first.key}` as TransactionSort
}

function changed(options: Options) {
  const next = { page: options.page, pageSize: options.itemsPerPage, sort: sortOf(options.sortBy) }
  if (next.page !== props.page || next.pageSize !== props.pageSize || next.sort !== props.sort) {
    emit('options', next)
  }
}

function account(transaction: Transaction) {
  return accounts.find(transaction.account_id)
}

/** Under the payee: the notes, or what the bank calls it when that's more than the payee. */
function detail(transaction: Transaction): string | null {
  const described = transaction.original_description
  if (transaction.notes || !described) return transaction.notes
  return described.toLowerCase() === transaction.payee.toLowerCase() ? null : described
}
</script>

<template>
  <v-data-table-server
    v-model="selected"
    v-model:page="page"
    v-model:items-per-page="itemsPerPage"
    v-model:sort-by="sortBy"
    :headers="headers"
    :items="items"
    :items-length="total"
    :loading="loading"
    :items-per-page-options="pageSizes"
    :show-select="selectable"
    :row-props="{ 'data-test': 'transaction-row' }"
    item-value="id"
    must-sort
    hover
    density="comfortable"
    class="transaction-table"
    data-test="transaction-table"
    @update:options="changed"
    @click:row="(_: Event, row: { item: Transaction }) => emit('open', row.item)"
  >
    <template #[`header.data-table-select`]="{ allSelected, someSelected, selectAll }">
      <v-checkbox-btn
        v-partly-checked="someSelected && !allSelected"
        :model-value="allSelected"
        :indeterminate="someSelected && !allSelected"
        density="comfortable"
        aria-label="Select all on this page"
        data-test="transaction-select-page"
        @update:model-value="selectAll"
      />
    </template>
    <template #[`item.date`]="{ item }">
      <span class="text-no-wrap">{{ formatListDate(item.date, locale) }}</span>
    </template>
    <template #[`item.payee`]="{ item }">
      <div class="transaction-table__payee py-2">
        <div class="d-flex align-center ga-2">
          <span class="font-weight-medium text-truncate">{{ item.payee }}</span>
          <v-chip v-if="item.pending" size="x-small" color="warning" variant="tonal"
            >Pending</v-chip
          >
        </div>
        <div v-if="detail(item)" class="text-body-small text-medium-emphasis text-truncate">
          {{ detail(item) }}
        </div>
      </div>
    </template>
    <template #[`item.category`]="{ item }">
      <CategoryChip :category-id="item.category_id" />
    </template>
    <template #[`item.account`]="{ item }">
      <span class="text-body-medium text-no-wrap">{{
        account(item)?.name ?? 'Deleted account'
      }}</span>
    </template>
    <template #[`item.amount`]="{ item }">
      <MoneyAmount
        :amount="item.amount"
        :currency="account(item)?.currency"
        signed
        class="font-weight-bold"
        :class="{ 'text-medium-emphasis': item.pending }"
      />
    </template>
    <template #[`item.actions`]="{ item }">
      <v-btn
        :icon="selectable ? Pencil : Eye"
        variant="text"
        size="small"
        :aria-label="selectable ? `Edit ${item.payee}` : `See ${item.payee}`"
        data-test="transaction-open"
        @click.stop="emit('open', item)"
      />
    </template>
  </v-data-table-server>
</template>

<style scoped>
.transaction-table :deep(tbody tr) {
  cursor: pointer;
}

.transaction-table__payee {
  max-width: 340px;
  min-width: 0;
}
</style>
