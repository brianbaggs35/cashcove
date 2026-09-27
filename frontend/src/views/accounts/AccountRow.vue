<script setup lang="ts">
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  EllipsisVertical,
  Link,
  Pencil,
  Trash2,
} from '@lucide/vue'
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import type { Account } from '@/api/accounts'
import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import { accountType } from '@/components/finance/accountTypes'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAuthStore } from '@/stores/auth'
import { closeAccount, removeAccount, reopenAccount } from '@/views/accounts/actions'
import { fromCents, negate, toCents } from '@/utils/money'

/** One account: what it is, what's in it or owed on it, and, for admins, what to do with it. */
const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ edit: [account: Account] }>()

const auth = useAuthStore()
const router = useRouter()
const { money } = useHousehold()
const { xs } = useDisplay()

const info = computed(() => accountType(props.account.type))
const linked = computed(() => props.account.source === 'plaid')
const transactionsLink = computed(() => ({
  path: '/transactions',
  query: { account: props.account.id },
}))

const details = computed(() =>
  [props.account.institution, props.account.mask && `•••• ${props.account.mask}`, info.value.title]
    .filter(Boolean)
    .join(' · '),
)

/** Cards and loans show what's owed, as people think of it, rather than a negative balance. */
const shown = computed(() => {
  const { balance } = props.account
  if (!info.value.liability) return { amount: balance, caption: null }
  const cents = toCents(balance)
  if (cents > 0) return { amount: balance, caption: 'in credit' }
  if (cents === 0) return { amount: balance, caption: 'paid off' }
  return { amount: negate(balance), caption: 'owed' }
})

const available = computed(() => {
  const { available_balance: amount, currency } = props.account
  return amount === null ? null : `${money(amount, currency)} available`
})

/** What's available, or else how fresh the balance is. */
function BalanceNote() {
  if (available.value) return available.value
  return ['Updated ', h(RelativeTime, { value: props.account.balance_updated_at })]
}

/** On phones the note goes under the details instead, leaving the account's name room. */
const noteBelow = computed(() => xs.value && !shown.value.caption)

/** How much of a card's limit is in use, when it has one and something is owed. */
const utilization = computed(() => {
  const limit = toCents(props.account.credit_limit ?? 0)
  const owed = -toCents(props.account.balance)
  if (limit <= 0 || owed <= 0) return null
  return { percent: Math.min(100, Math.round((owed / limit) * 100)), limit: fromCents(limit) }
})
</script>

<template>
  <div
    class="account-row d-flex align-center"
    :class="{ 'account-row--closed': account.closed_at }"
    data-test="account-row"
  >
    <router-link
      :to="transactionsLink"
      class="account-row__main d-flex align-center ga-4 flex-grow-1 py-3 ps-3 pe-2"
      data-test="account-link"
    >
      <AccountAvatar :type="account.type" size="44" />
      <div class="flex-grow-1" style="min-width: 0">
        <div class="d-flex align-center flex-wrap ga-2">
          <span class="text-title-small font-weight-bold text-break" data-test="account-name">
            {{ account.name }}
          </span>
          <v-chip
            v-if="linked"
            size="x-small"
            color="secondary"
            variant="tonal"
            :prepend-icon="Link"
            data-test="account-linked"
          >
            Linked
          </v-chip>
        </div>
        <div class="text-body-small text-medium-emphasis text-truncate" data-test="account-details">
          {{ details }}
        </div>
        <div
          v-if="utilization"
          class="account-row__utilization d-flex align-center ga-2 mt-1"
          data-test="account-utilization"
        >
          <v-progress-linear
            :model-value="utilization.percent"
            :color="
              utilization.percent >= 90
                ? 'error'
                : utilization.percent >= 30
                  ? 'warning'
                  : 'success'
            "
            height="6"
            rounded
            :aria-label="`${utilization.percent}% of the credit limit used`"
          />
          <span class="text-label-small text-medium-emphasis text-no-wrap">
            {{ utilization.percent }}% of {{ money(utilization.limit, account.currency) }}
          </span>
        </div>
        <div
          v-if="noteBelow"
          class="text-label-small text-medium-emphasis"
          data-test="account-note"
        >
          <BalanceNote />
        </div>
      </div>
      <div class="text-end flex-shrink-0">
        <MoneyAmount
          :amount="shown.amount"
          :currency="account.currency"
          class="text-title-small font-weight-bold"
          data-test="account-balance"
        />
        <div
          v-if="!noteBelow"
          class="text-label-small text-medium-emphasis text-no-wrap"
          data-test="account-note"
        >
          <template v-if="shown.caption">{{ shown.caption }}</template>
          <BalanceNote v-else />
        </div>
      </div>
    </router-link>

    <v-menu v-if="auth.isAdmin" location="bottom end">
      <template #activator="{ props: activator }">
        <v-btn
          v-bind="activator"
          :icon="EllipsisVertical"
          variant="text"
          size="small"
          class="me-1"
          :aria-label="`Actions for ${account.name}`"
          data-test="account-actions"
        />
      </template>
      <v-list density="compact" nav min-width="220">
        <v-list-item
          :prepend-icon="Pencil"
          title="Edit"
          data-test="account-edit"
          @click="emit('edit', account)"
        />
        <!-- Items in a menu's list are buttons, not links, so the list stays a valid list. -->
        <v-list-item
          :prepend-icon="ArrowLeftRight"
          title="See transactions"
          data-test="account-transactions"
          @click="router.push(transactionsLink)"
        />
        <v-divider class="my-1" aria-hidden="true" />
        <v-list-item
          v-if="account.closed_at"
          :prepend-icon="ArchiveRestore"
          title="Reopen"
          data-test="account-reopen"
          @click="reopenAccount(account)"
        />
        <v-list-item
          v-else
          :prepend-icon="Archive"
          title="Close account"
          data-test="account-close"
          @click="closeAccount(account)"
        />
        <v-list-item
          :prepend-icon="Trash2"
          title="Delete"
          base-color="error"
          data-test="account-delete"
          @click="removeAccount(account)"
        />
      </v-list>
    </v-menu>
  </div>
</template>

<style scoped>
.account-row {
  border-radius: 14px;
  transition: background-color 0.15s;
}

.account-row:hover,
.account-row:focus-within {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.account-row__main {
  min-width: 0;
  color: inherit;
  text-decoration: none;
  border-radius: 14px;
}

.account-row__main:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.account-row__utilization {
  max-width: 320px;
}

.account-row--closed :deep(.v-avatar) {
  filter: grayscale(1);
  opacity: 0.7;
}
</style>
