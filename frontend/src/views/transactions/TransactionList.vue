<script setup lang="ts">
import { CircleDashed } from '@lucide/vue'
import { computed } from 'vue'

import type { Transaction } from '@/api/transactions'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { formatListDate, fromIsoDate } from '@/utils/dates'
import { formatDay } from '@/utils/format'

/** The transactions as a list for phones, under a heading for each day when in date order. */
const props = defineProps<{ items: Transaction[]; byDay: boolean }>()
const emit = defineEmits<{ open: [transaction: Transaction] }>()

const accounts = useAccountsStore()
const categories = useCategoriesStore()
const { locale } = useHousehold()

interface Section {
  key: string
  heading: string | null
  items: Transaction[]
}

const sections = computed<Section[]>(() => {
  if (!props.byDay) return [{ key: 'all', heading: null, items: props.items }]
  const list: Section[] = []
  const now = new Date()
  for (const item of props.items) {
    const last = list.at(-1)
    if (last?.key === item.date) last.items.push(item)
    else {
      const heading = formatDay(fromIsoDate(item.date), now, locale.value)
      list.push({ key: item.date, heading, items: [item] })
    }
  }
  return list
})

/** The category's emoji, or nothing for a transaction that has no category. */
function emojiOf(transaction: Transaction): string | undefined {
  return categories.find(transaction.category_id)?.emoji
}

function describe(transaction: Transaction): string {
  const parts = [
    categories.find(transaction.category_id)?.name ?? 'Uncategorized',
    accounts.find(transaction.account_id)?.name,
  ]
  if (!props.byDay) parts.unshift(formatListDate(transaction.date, locale.value))
  return parts.filter(Boolean).join(' · ')
}
</script>

<template>
  <div data-test="transaction-list">
    <section v-for="section in sections" :key="section.key">
      <h2
        v-if="section.heading"
        class="transaction-list__day text-label-large font-weight-bold px-4 pt-4 pb-1 ma-0"
        data-test="transaction-day"
      >
        {{ section.heading }}
      </h2>
      <v-list bg-color="transparent" class="py-0" lines="two">
        <v-list-item
          v-for="item in section.items"
          :key="item.id"
          class="px-4"
          data-test="transaction-item"
          @click="emit('open', item)"
        >
          <template #prepend>
            <v-avatar size="40" rounded="lg" class="transaction-list__icon me-3">
              <span v-if="emojiOf(item)" aria-hidden="true">
                {{ emojiOf(item) }}
              </span>
              <v-icon v-else :icon="CircleDashed" size="18" />
            </v-avatar>
          </template>
          <v-list-item-title class="d-flex align-center ga-2">
            <span class="font-weight-medium text-truncate">{{ item.payee }}</span>
            <v-chip v-if="item.pending" size="x-small" color="warning" variant="tonal">
              Pending
            </v-chip>
          </v-list-item-title>
          <v-list-item-subtitle>{{ describe(item) }}</v-list-item-subtitle>
          <template #append>
            <MoneyAmount
              :amount="item.amount"
              :currency="accounts.find(item.account_id)?.currency"
              signed
              class="font-weight-bold ms-2"
              :class="{ 'text-medium-emphasis': item.pending }"
            />
          </template>
        </v-list-item>
      </v-list>
    </section>
  </div>
</template>

<style scoped>
.transaction-list__day {
  letter-spacing: 0.02em;
}

.transaction-list__icon {
  font-size: 1.25rem;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
</style>
