<script setup lang="ts">
import { ArrowDownUp, CalendarRange, ListFilter, Search } from '@lucide/vue'
import { onScopeDispose, ref, watch } from 'vue'

import type { TransactionSort } from '@/api/transactions'
import { periods, type PeriodKey } from '@/utils/dates'
import type { TransactionFilters } from '@/views/transactions/view'

/** Search, the period, the way into the other filters, and on phones, the order. */
const props = defineProps<{
  filters: TransactionFilters
  sort: TransactionSort
  /** How many other filters are on, shown on the Filters button. */
  filterCount: number
}>()
const emit = defineEmits<{
  search: [q: string]
  period: [period: PeriodKey]
  sort: [sort: TransactionSort]
  /** Opens the filters, at the dates when choosing a custom period. */
  filters: [focus?: 'dates']
}>()

const sorts: { value: TransactionSort; title: string }[] = [
  { value: '-date', title: 'Newest first' },
  { value: 'date', title: 'Oldest first' },
  { value: '-amount', title: 'Most money in first' },
  { value: 'amount', title: 'Most money out first' },
  { value: 'payee', title: 'Payee A to Z' },
  { value: '-payee', title: 'Payee Z to A' },
]

const periodItems = [...periods, { value: 'custom' as const, title: 'Custom dates…' }]

// Searching waits for a pause in typing, so each keystroke doesn't reload the list.
const text = ref(props.filters.q)
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.filters.q,
  (q) => {
    if (q !== text.value.trim()) text.value = q
  },
)

function typed(value: string | null) {
  text.value = value ?? ''
  clearTimeout(timer)
  timer = setTimeout(() => {
    emit('search', text.value.trim())
  }, 300)
}

function searchNow() {
  clearTimeout(timer)
  emit('search', text.value.trim())
}

onScopeDispose(() => {
  clearTimeout(timer)
})

function choosePeriod(value: PeriodKey | 'custom') {
  if (value === 'custom') emit('filters', 'dates')
  else emit('period', value)
}
</script>

<template>
  <div class="transaction-toolbar d-flex flex-wrap align-center ga-3 mb-4">
    <v-text-field
      :model-value="text"
      :prepend-inner-icon="Search"
      label="Search payees, notes, categories or amounts"
      type="search"
      density="comfortable"
      hide-details
      clearable
      class="transaction-toolbar__search"
      data-test="transaction-search"
      @update:model-value="typed"
      @keydown.enter="searchNow"
    />
    <v-select
      :model-value="filters.period"
      :items="periodItems"
      :prepend-inner-icon="CalendarRange"
      label="Period"
      density="comfortable"
      hide-details
      class="transaction-toolbar__period"
      data-test="transaction-period"
      @update:model-value="choosePeriod"
    />
    <v-badge
      :model-value="filterCount > 0"
      :content="filterCount"
      color="primary"
      offset-x="4"
      offset-y="4"
    >
      <v-btn
        variant="outlined"
        height="48"
        :prepend-icon="ListFilter"
        data-test="transaction-filters"
        @click="emit('filters')"
      >
        Filters
      </v-btn>
    </v-badge>
    <v-menu location="bottom end">
      <template #activator="{ props: activator }">
        <v-btn
          v-bind="activator"
          variant="outlined"
          height="48"
          class="d-md-none"
          :prepend-icon="ArrowDownUp"
          data-test="transaction-sort"
        >
          Sort
        </v-btn>
      </template>
      <v-list density="compact" nav :selected="[sort]" color="primary">
        <v-list-item
          v-for="option in sorts"
          :key="option.value"
          :value="option.value"
          :title="option.title"
          :data-test="`transaction-sort-${option.value}`"
          @click="emit('sort', option.value)"
        />
      </v-list>
    </v-menu>
  </div>
</template>

<style scoped>
.transaction-toolbar__search {
  flex: 1 1 280px;
}

.transaction-toolbar__period {
  flex: 0 1 220px;
  min-width: 180px;
}
</style>
