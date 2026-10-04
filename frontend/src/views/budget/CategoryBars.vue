<script setup lang="ts">
import { computed } from 'vue'

import type { CategoryTotal } from '@/api/budget'
import { useHousehold } from '@/composables/useHousehold'
import { useCategoriesStore } from '@/stores/categories'
import { sumAmounts, toCents } from '@/utils/money'

/** Where the money went: the categories with the most spent in them, as bars. Those past the first few are counted together. */
const props = defineProps<{ categories: CategoryTotal[] }>()

const SHOWN = 6

const { money } = useHousehold()
const categoryStore = useCategoriesStore()

interface Row {
  key: string
  emoji: string
  name: string
  amount: string
  share: number
  width: number
}

const rows = computed<Row[]>(() => {
  const total = toCents(sumAmounts(props.categories.map((item) => item.amount)))
  const shown = props.categories.slice(0, SHOWN)
  const rest = props.categories.slice(SHOWN)
  const items = shown.map((item) => {
    const category = categoryStore.find(item.category_id)
    return {
      key: item.category_id ?? 'none',
      emoji: category?.emoji ?? '',
      name: category?.name ?? 'Uncategorized',
      amount: item.amount,
    }
  })
  if (rest.length) {
    items.push({
      key: 'rest',
      emoji: '',
      name: 'Everything else',
      amount: sumAmounts(rest.map((item) => item.amount)),
    })
  }
  const largest = Math.max(...items.map((item) => toCents(item.amount)))
  return items.map((item) => ({
    ...item,
    share: Math.round((toCents(item.amount) / total) * 100),
    width: (toCents(item.amount) / largest) * 100,
  }))
})
</script>

<template>
  <ul class="chart category-bars pa-0 ma-0" data-test="category-bars">
    <li v-for="row in rows" :key="row.key" class="category-bars__row" data-test="category-bar">
      <div class="d-flex align-baseline ga-2">
        <span class="text-body-medium text-truncate flex-grow-1" data-test="category-bar-name">
          <span v-if="row.emoji" class="me-1" aria-hidden="true">{{ row.emoji }}</span>
          {{ row.name }}
        </span>
        <span
          class="text-body-medium font-weight-medium tabular-nums"
          data-test="category-bar-amount"
        >
          {{ money(row.amount) }}
        </span>
        <span
          class="text-body-small text-medium-emphasis tabular-nums category-bars__share"
          data-test="category-bar-share"
        >
          {{ row.share }}%
        </span>
      </div>
      <div class="category-bars__track" aria-hidden="true">
        <div class="category-bars__bar" :style="{ width: `${row.width}%` }" />
      </div>
    </li>
  </ul>
</template>

<style scoped>
.category-bars {
  list-style: none;
}

.category-bars__row + .category-bars__row {
  margin-top: 14px;
}

.category-bars__share {
  min-width: 3ch;
  text-align: end;
}

.category-bars__track {
  margin-top: 6px;
  height: 10px;
}

/* Thin, square where it starts and rounded at the end. */
.category-bars__bar {
  height: 100%;
  border-radius: 0 4px 4px 0;
  background: var(--chart-spent);
}
</style>
