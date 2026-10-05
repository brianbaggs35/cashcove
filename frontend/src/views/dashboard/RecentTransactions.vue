<script setup lang="ts">
import { ArrowLeftRight } from '@lucide/vue'
import { computed } from 'vue'

import type { Transaction } from '@/api/transactions'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import DashboardCard from '@/views/dashboard/DashboardCard.vue'

/** The latest transactions, whichever account they are in. */
const props = defineProps<{ transactions: Transaction[] }>()

const accounts = useAccountsStore()
const { locale } = useHousehold()

const rows = computed(() =>
  props.transactions.map((transaction) => ({
    transaction,
    date: formatShortDate(fromIsoDate(transaction.date), locale.value),
    account: accounts.find(transaction.account_id),
  })),
)
</script>

<template>
  <DashboardCard
    title="Recent transactions"
    :icon="ArrowLeftRight"
    :to="transactions.length ? '/transactions' : undefined"
    data-test="recent-transactions"
  >
    <EmptyState
      v-if="!transactions.length"
      compact
      :icon="ArrowLeftRight"
      title="No transactions yet"
      text="Import a statement or connect a bank, and what moved shows up here."
    >
      <v-btn to="/import" variant="outlined" data-test="recent-import">Import a statement</v-btn>
      <v-btn to="/connect" variant="outlined" data-test="recent-connect">Connect a bank</v-btn>
    </EmptyState>
    <ul v-else class="recent pa-0 ma-0">
      <li
        v-for="row in rows"
        :key="row.transaction.id"
        class="recent__row d-flex align-center ga-3"
        data-test="recent-transaction"
      >
        <div class="flex-grow-1 min-width-0">
          <p class="text-body-medium font-weight-medium text-truncate ma-0">
            {{ row.transaction.payee }}
          </p>
          <p class="text-body-small text-medium-emphasis text-truncate ma-0">
            {{ row.date }}<template v-if="row.account"> · {{ row.account.name }}</template>
          </p>
        </div>
        <CategoryChip :category-id="row.transaction.category_id" class="recent__category" />
        <MoneyAmount
          :amount="row.transaction.amount"
          :currency="row.account?.currency"
          signed
          class="font-weight-medium"
        />
      </li>
    </ul>
  </DashboardCard>
</template>

<style scoped>
.recent {
  list-style: none;
}

.recent__row {
  padding-block: 10px;
}

.recent__row + .recent__row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.min-width-0 {
  min-width: 0;
}

/* A phone has no room for the category beside the payee and the amount. */
@media (max-width: 599px) {
  .recent__category {
    display: none;
  }
}
</style>
