<script setup lang="ts">
import { CalendarRange, CircleDashed, FileUp, Landmark, Scale, type LucideIcon } from '@lucide/vue'
import { computed, watch } from 'vue'

import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useImportsStore } from '@/stores/imports'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { formatDateRange } from '@/utils/dates'
import { kinds } from '@/views/subscriptions/kinds'
import type { TransactionFilters } from '@/views/transactions/view'

/** The filters narrowing the list, each removable on its own. */
const props = defineProps<{ filters: TransactionFilters }>()
const emit = defineEmits<{ change: [changes: Partial<TransactionFilters>]; clear: [] }>()

const accounts = useAccountsStore()
const categories = useCategoriesStore()
const imports = useImportsStore()
const subscriptions = useSubscriptionsStore()
const { locale, money } = useHousehold()

// Names the subscription or bill whose payments are listed.
watch(
  () => props.filters.subscriptionId,
  (id) => {
    if (id) void subscriptions.ensureLoaded()
  },
  { immediate: true },
)

interface Chip {
  key: string
  label: string
  icon?: LucideIcon
  emoji?: string
  remove: Partial<TransactionFilters>
}

const SOURCES = { manual: 'Added by hand', plaid: 'From the bank', file: 'Imported from a file' }

function accountChips({ accounts: ids }: TransactionFilters): Chip[] {
  return ids.map((id) => ({
    key: `account-${id}`,
    label: accounts.find(id)?.name ?? 'Deleted account',
    icon: Landmark,
    remove: { accounts: ids.filter((item) => item !== id) },
  }))
}

function categoryChips({ uncategorized, categories: ids }: TransactionFilters): Chip[] {
  const list: Chip[] = ids.map((id) => {
    const category = categories.find(id)
    return {
      key: `category-${id}`,
      label: category?.name ?? 'Deleted category',
      emoji: category?.emoji,
      remove: { categories: ids.filter((item) => item !== id) },
    }
  })
  if (uncategorized) {
    list.unshift({
      key: 'uncategorized',
      label: 'Uncategorized',
      icon: CircleDashed,
      remove: { uncategorized: false },
    })
  }
  return list
}

function dateChips({ period, start, end }: TransactionFilters): Chip[] {
  if (period !== 'custom') return []
  return [
    {
      key: 'dates',
      label: formatDateRange({ start: start ?? undefined, end: end ?? undefined }, locale.value),
      icon: CalendarRange,
      remove: { period: 'all', start: null, end: null },
    },
  ]
}

function choiceChips({ direction, status }: TransactionFilters): Chip[] {
  const list: Chip[] = []
  if (direction) {
    list.push({
      key: 'direction',
      label: direction === 'in' ? 'Money in' : 'Money out',
      remove: { direction: null },
    })
  }
  if (status) {
    list.push({
      key: 'status',
      label: status === 'pending' ? 'Pending' : 'Posted',
      remove: { status: null },
    })
  }
  return list
}

function sourceChips({ sources }: TransactionFilters): Chip[] {
  return sources.map((source) => ({
    key: `source-${source}`,
    label: SOURCES[source],
    remove: { sources: sources.filter((item) => item !== source) },
  }))
}

function importChips({ importId }: TransactionFilters): Chip[] {
  if (!importId) return []
  const record = imports.findImport(importId)
  return [
    {
      key: 'import',
      label: record ? `From ${record.file_name}` : 'From an import',
      icon: FileUp,
      remove: { importId: null },
    },
  ]
}

function subscriptionChips({ subscriptionId }: TransactionFilters): Chip[] {
  if (!subscriptionId) return []
  const found = subscriptions.find(subscriptionId)
  return [
    {
      key: 'subscription',
      label: found ? `${found.name} payments` : 'Subscription or bill payments',
      icon: found ? kinds[found.kind].icon : undefined,
      remove: { subscriptionId: null },
    },
  ]
}

/** The amount range, from whichever ends are set. */
function amountLabel(min: string | null, max: string | null): string {
  if (min && max) return `${money(min)} to ${money(max)}`
  if (min) return `At least ${money(min)}`
  return `At most ${money(max as string)}`
}

function amountChips({ min, max }: TransactionFilters): Chip[] {
  if (!min && !max) return []
  return [
    { key: 'amount', label: amountLabel(min, max), icon: Scale, remove: { min: null, max: null } },
  ]
}

const chips = computed<Chip[]>(() => [
  ...accountChips(props.filters),
  ...categoryChips(props.filters),
  ...dateChips(props.filters),
  ...choiceChips(props.filters),
  ...sourceChips(props.filters),
  ...importChips(props.filters),
  ...subscriptionChips(props.filters),
  ...amountChips(props.filters),
])
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
