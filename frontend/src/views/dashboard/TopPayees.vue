<script setup lang="ts">
import { Store } from '@lucide/vue'
import { computed } from 'vue'

import type { PayeeTotal } from '@/api/dashboard'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { formatCount } from '@/utils/format'
import { toCents } from '@/utils/money'
import DashboardCard from '@/views/dashboard/DashboardCard.vue'

/** The payees this month's money went to the most, each a link to what was spent with them. */
const props = defineProps<{ payees: PayeeTotal[] }>()

const { money } = useHousehold()

const rows = computed(() => {
  const largest = Math.max(...props.payees.map((item) => toCents(item.amount)))
  return props.payees.map((item) => ({
    ...item,
    text: money(item.amount),
    times: formatCount(item.count, 'transaction'),
    width: (toCents(item.amount) / largest) * 100,
    to: { path: '/transactions', query: { q: item.payee, period: 'this-month', direction: 'out' } },
  }))
})
</script>

<template>
  <DashboardCard title="Top payees" :icon="Store" data-test="top-payees">
    <EmptyState
      v-if="!payees.length"
      compact
      :icon="Store"
      title="No spending yet this month"
      text="The places you spend the most show up here."
    />
    <ol v-else class="payees chart pa-0 ma-0">
      <li v-for="row in rows" :key="row.payee" data-test="top-payee">
        <router-link :to="row.to" class="payees__link">
          <span class="d-flex align-baseline ga-2">
            <span class="text-body-medium text-truncate flex-grow-1" data-test="top-payee-name">
              {{ row.payee }}
            </span>
            <span class="text-body-medium font-weight-medium tabular-nums">{{ row.text }}</span>
          </span>
          <span class="payees__track" aria-hidden="true">
            <span class="payees__bar" :style="{ width: `${row.width}%` }" />
          </span>
          <span class="d-block text-body-small text-medium-emphasis">{{ row.times }}</span>
        </router-link>
      </li>
    </ol>
  </DashboardCard>
</template>

<style scoped>
.payees {
  display: grid;
  gap: 14px;
  list-style: none;
}

.payees__link {
  display: block;
  color: inherit;
  text-decoration: none;
  border-radius: 8px;
}

.payees__link:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 4px;
}

.payees__track {
  display: block;
  height: 10px;
  margin-block: 6px 4px;
}

/* Thin, square where it starts and rounded at the end. */
.payees__bar {
  display: block;
  height: 100%;
  border-radius: 0 4px 4px 0;
  background: var(--chart-spent);
}
</style>
