<script setup lang="ts">
import { CalendarRange, CircleDashed, Landmark, Scale, type LucideIcon } from '@lucide/vue'
import { computed } from 'vue'

import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { formatDateRange } from '@/utils/dates'
import type { TransactionFilters } from '@/views/transactions/view'

/** The filters narrowing the list, each removable on its own. */
const props = defineProps<{ filters: TransactionFilters }>()
const emit = defineEmits<{ change: [changes: Partial<TransactionFilters>]; clear: [] }>()

const accounts = useAccountsStore()
const categories = useCategoriesStore()
const { locale, money } = useHousehold()

interface Chip {
  key: string
  label: string
  icon?: LucideIcon
  emoji?: string
  remove: Partial<TransactionFilters>
}

const SOURCES = { manual: 'Added by hand', plaid: 'From the bank', file: 'Imported from a file' }

const chips = computed<Chip[]>(() => {
  const { filters } = props
  const list: Chip[] = []
  for (const id of filters.accounts) {
    list.push({
      key: `account-${id}`,
      label: accounts.find(id)?.name ?? 'Deleted account',
      icon: Landmark,
      remove: { accounts: filters.accounts.filter((item) => item !== id) },
    })
  }
  if (filters.uncategorized) {
    list.push({
      key: 'uncategorized',
      label: 'Uncategorized',
      icon: CircleDashed,
      remove: { uncategorized: false },
    })
  }
  for (const id of filters.categories) {
    const category = categories.find(id)
    list.push({
      key: `category-${id}`,
      label: category?.name ?? 'Deleted category',
      emoji: category?.emoji,
      remove: { categories: filters.categories.filter((item) => item !== id) },
    })
  }
  if (filters.period === 'custom') {
    list.push({
      key: 'dates',
      label: formatDateRange(
        { start: filters.start ?? undefined, end: filters.end ?? undefined },
        locale.value,
      ),
      icon: CalendarRange,
      remove: { period: 'all', start: null, end: null },
    })
  }
  if (filters.direction) {
    list.push({
      key: 'direction',
      label: filters.direction === 'in' ? 'Money in' : 'Money out',
      remove: { direction: null },
    })
  }
  if (filters.status) {
    list.push({
      key: 'status',
      label: filters.status === 'pending' ? 'Pending' : 'Posted',
      remove: { status: null },
    })
  }
  for (const source of filters.sources) {
    list.push({
      key: `source-${source}`,
      label: SOURCES[source],
      remove: { sources: filters.sources.filter((item) => item !== source) },
    })
  }
  if (filters.min || filters.max) {
    const min = filters.min && money(filters.min)
    const max = filters.max && money(filters.max)
    list.push({
      key: 'amount',
      label: min && max ? `${min} to ${max}` : min ? `At least ${min}` : `At most ${max}`,
      icon: Scale,
      remove: { min: null, max: null },
    })
  }
  return list
})
</script>

<template>
  <div v-if="chips.length" class="d-flex flex-wrap align-center ga-2 mb-4" data-test="filter-chips">
    <v-chip
      v-for="chip in chips"
      :key="chip.key"
      :prepend-icon="chip.icon"
      closable
      variant="tonal"
      color="primary"
      :close-label="`Remove ${chip.label}`"
      :data-test="`filter-chip-${chip.key}`"
      @click:close="emit('change', chip.remove)"
    >
      <span v-if="chip.emoji" class="me-1" aria-hidden="true">{{ chip.emoji }}</span>
      {{ chip.label }}
    </v-chip>
    <v-btn variant="text" size="small" data-test="filter-chips-clear" @click="emit('clear')">
      Clear all
    </v-btn>
  </div>
</template>
