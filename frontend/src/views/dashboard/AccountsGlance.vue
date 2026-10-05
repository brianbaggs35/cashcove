<script setup lang="ts">
import { ArrowRight } from '@lucide/vue'
import { computed } from 'vue'

import type { Account } from '@/api/accounts'
import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { toCents } from '@/utils/money'

/** The accounts with the most in them, or owed on them, for under the net worth. */
const props = defineProps<{ accounts: Account[] }>()

/** How many accounts are listed before the rest are left to the Accounts tab. */
const SHOWN = 4

const biggest = computed(() =>
  [...props.accounts]
    .sort((a, b) => Math.abs(toCents(b.balance)) - Math.abs(toCents(a.balance)))
    .slice(0, SHOWN),
)
const more = computed(() => props.accounts.length - SHOWN)
</script>

<template>
  <div class="glance mt-5 pt-4" data-test="accounts-glance">
    <ul class="pa-0 ma-0">
      <li
        v-for="account in biggest"
        :key="account.id"
        class="d-flex align-center ga-3"
        data-test="glance-account"
      >
        <AccountAvatar :type="account.type" :size="34" />
        <div class="flex-grow-1 min-width-0">
          <p class="text-body-medium font-weight-medium text-truncate ma-0">{{ account.name }}</p>
          <p
            v-if="account.institution"
            class="text-body-small text-medium-emphasis text-truncate ma-0"
          >
            {{ account.institution }}
          </p>
        </div>
        <MoneyAmount
          :amount="account.balance"
          :currency="account.currency"
          class="font-weight-medium"
        />
      </li>
    </ul>
    <v-btn
      to="/accounts"
      variant="text"
      size="small"
      color="primary"
      :append-icon="ArrowRight"
      class="mt-2 ms-n2"
      data-test="glance-all"
    >
      <template v-if="more > 0">View all {{ accounts.length }} accounts</template>
      <template v-else>View accounts</template>
    </v-btn>
  </div>
</template>

<style scoped>
.glance {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.glance ul {
  display: grid;
  gap: 12px;
  list-style: none;
}

.min-width-0 {
  min-width: 0;
}
</style>
