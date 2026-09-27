<script setup lang="ts">
import { Archive, Landmark, Plug, Plus } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import type { Account } from '@/api/accounts'
import { accountGroups, accountType } from '@/components/finance/accountTypes'
import TabPage from '@/components/TabPage.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { useAuthStore } from '@/stores/auth'
import { useAccountsStore } from '@/stores/accounts'
import AccountDialog from '@/views/accounts/AccountDialog.vue'
import AccountGroupCard from '@/views/accounts/AccountGroupCard.vue'
import AccountRow from '@/views/accounts/AccountRow.vue'
import NetWorthCard from '@/views/accounts/NetWorthCard.vue'

const auth = useAuthStore()
const store = useAccountsStore()

// Balances change as transactions come in, so the tab always shows the latest.
onMounted(() => void store.load())

const groups = computed(() =>
  accountGroups
    .map((group) => ({
      group,
      accounts: store.open.filter((account) => accountType(account.type).group === group.key),
    }))
    .filter((item) => item.accounts.length > 0),
)

const dialog = ref(false)
const editing = ref<Account | null>(null)

function add() {
  editing.value = null
  dialog.value = true
}

function edit(account: Account) {
  editing.value = account
  dialog.value = true
}
</script>

<template>
  <TabPage name="accounts">
    <template v-if="auth.isAdmin && store.accounts.length" #actions>
      <v-btn color="primary" variant="flat" :prepend-icon="Plus" data-test="account-add" @click="add">
        Add account
      </v-btn>
    </template>

    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      text="You can see every account. Only an admin can add or change them."
    />

    <v-alert
      v-if="store.error && !store.loaded"
      type="error"
      variant="tonal"
      :text="`Couldn't load your accounts. ${store.error}`"
      data-test="accounts-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="accounts-retry" @click="store.load()">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-else-if="!store.loaded" data-test="accounts-loading">
      <v-skeleton-loader type="heading, text" class="mb-6 rounded-xl" />
      <v-skeleton-loader type="list-item-avatar-two-line@3" class="rounded-xl" />
    </div>

    <v-card v-else-if="!store.accounts.length">
      <EmptyState
        :icon="Landmark"
        title="No accounts yet"
        :text="
          auth.isAdmin
            ? 'Add the accounts you want to keep track of, like checking, savings, credit cards, loans or cash.'
            : 'An admin hasn\'t added any accounts yet.'
        "
      >
        <template v-if="auth.isAdmin">
          <v-btn
            color="primary"
            variant="flat"
            :prepend-icon="Plus"
            data-test="account-add-first"
            @click="add"
          >
            Add an account
          </v-btn>
          <v-btn variant="outlined" :prepend-icon="Plug" to="/connect">Connect a bank</v-btn>
        </template>
      </EmptyState>
    </v-card>

    <template v-else>
      <NetWorthCard :accounts="store.open" />

      <AccountGroupCard
        v-for="{ group, accounts } in groups"
        :key="group.key"
        :group="group"
        :accounts="accounts"
        @edit="edit"
      />

      <v-expansion-panels v-if="store.closed.length" class="mt-2" data-test="accounts-closed">
        <v-expansion-panel elevation="0" rounded="xl" class="closed-accounts">
          <v-expansion-panel-title>
            <div class="d-flex align-center ga-3">
              <v-icon :icon="Archive" size="18" class="text-medium-emphasis" />
              <span class="text-title-small font-weight-bold">Closed accounts</span>
              <v-chip size="x-small" variant="tonal">{{ store.closed.length }}</v-chip>
            </div>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="text-body-small text-medium-emphasis mt-0 mb-2">
              Closed accounts keep their transactions and don't count toward your net worth.
            </p>
            <AccountRow
              v-for="account in store.closed"
              :key="account.id"
              :account="account"
              @edit="edit"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>

    <AccountDialog v-if="auth.isAdmin" v-model="dialog" :account="editing" />
  </TabPage>
</template>

<style scoped>
.closed-accounts {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
