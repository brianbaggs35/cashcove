<script setup lang="ts">
import { computed } from 'vue'

import type { Account } from '@/api/accounts'
import type { AccountGroupInfo } from '@/components/finance/accountTypes'
import { accountType } from '@/components/finance/accountTypes'
import { useHousehold } from '@/composables/useHousehold'
import AccountRow from '@/views/accounts/AccountRow.vue'
import { totalsByCurrency } from '@/views/accounts/totals'
import { negate } from '@/utils/money'

/** The accounts of one kind, e.g. credit cards, with what they add up to. */
const props = defineProps<{ group: AccountGroupInfo; accounts: Account[] }>()
const emit = defineEmits<{ edit: [account: Account] }>()

const { currency, money } = useHousehold()

/** Cards and loans add up what's owed; everything else what's in them. */
const owed = computed(() => props.accounts.every((account) => accountType(account.type).liability))
const total = computed(() =>
  totalsByCurrency(props.accounts, currency.value)
    .map((item) => money(owed.value ? negate(item.amount) : item.amount, item.currency))
    .join(' · '),
)
</script>

<template>
  <v-card class="account-group mb-4" :data-test="`account-group-${group.key}`">
    <div class="d-flex align-center flex-wrap ga-2 px-5 pt-4 pb-2">
      <h2 class="text-title-medium font-weight-bold ma-0">{{ group.title }}</h2>
      <v-chip size="x-small" variant="tonal" :color="group.color">{{ accounts.length }}</v-chip>
      <v-spacer />
      <div class="text-end">
        <div class="text-title-small font-weight-bold tabular-nums" data-test="account-group-total">
          {{ total }}
        </div>
        <div v-if="owed" class="text-label-small text-medium-emphasis">owed</div>
      </div>
    </div>
    <div class="px-2 pb-2">
      <AccountRow
        v-for="account in accounts"
        :key="account.id"
        :account="account"
        @edit="emit('edit', $event)"
      />
    </div>
  </v-card>
</template>
