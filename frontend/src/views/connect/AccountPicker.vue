<script setup lang="ts">
import { Check, Pencil } from '@lucide/vue'
import { computed, ref } from 'vue'

import type { SharedAccount } from '@/api/connections'
import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import { accountType } from '@/components/finance/accountTypes'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { negate } from '@/utils/money'

/**
 * The accounts a bank shares, to tick the ones to import and, if wanted, rename them. Unticked
 * ones are left out, and can be imported later.
 */
const props = defineProps<{
  accounts: SharedAccount[]
  /** Shows which accounts are new since they were last chosen. */
  showNew?: boolean
  disabled?: boolean
}>()
const selected = defineModel<string[]>('selected', { required: true })
const names = defineModel<Record<string, string>>('names', { required: true })

const editing = ref<string | null>(null)

const all = computed(() => selected.value.length === props.accounts.length)
const some = computed(() => selected.value.length > 0 && !all.value)

function toggleAll() {
  selected.value = all.value ? [] : props.accounts.map((account) => account.id)
}

/** Hands back a new set of names, so whoever holds them sees the change. */
function rename(id: string, name: string) {
  names.value = { ...names.value, [id]: name }
}

function details(account: SharedAccount): string {
  return [account.mask && `•••• ${account.mask}`, accountType(account.type).title]
    .filter(Boolean)
    .join(' · ')
}

/** Cards and loans show what's owed, as on the Accounts tab. */
function balance(account: SharedAccount) {
  return accountType(account.type).liability
    ? { amount: negate(account.balance), caption: 'owed' }
    : { amount: account.balance, caption: null }
}

const nameRules = [
  (value: string) => !!value.trim() || 'Enter a name',
  (value: string) => value.length <= 80 || 'Keep it under 80 characters',
]
</script>

<template>
  <div class="account-picker" data-test="account-picker">
    <v-checkbox
      :model-value="all"
      :indeterminate="some"
      :disabled="disabled"
      :label="`All accounts (${accounts.length})`"
      color="primary"
      density="compact"
      hide-details
      class="account-picker__all mb-1"
      data-test="account-picker-all"
      @update:model-value="toggleAll"
    />
    <div
      v-for="account in accounts"
      :key="account.id"
      class="account-picker__row"
      :class="{ 'account-picker__row--selected': selected.includes(account.id) }"
      data-test="account-picker-row"
    >
      <div class="d-flex align-center ga-3">
        <v-checkbox
          v-model="selected"
          :value="account.id"
          :disabled="disabled"
          :aria-label="`Import ${names[account.id]}`"
          color="primary"
          density="compact"
          hide-details
          class="flex-grow-0"
          data-test="account-picker-check"
        />
        <AccountAvatar :type="account.type" size="40" />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="d-flex align-center flex-wrap ga-2">
            <span
              class="text-title-small font-weight-bold text-break"
              data-test="account-picker-name"
            >
              {{ names[account.id] }}
            </span>
            <v-chip
              v-if="showNew && account.state === 'new'"
              size="x-small"
              color="accent"
              variant="tonal"
              data-test="account-picker-new"
            >
              New
            </v-chip>
          </div>
          <div class="text-body-small text-medium-emphasis text-truncate">
            {{ details(account) }}
          </div>
        </div>
        <div class="text-end flex-shrink-0">
          <MoneyAmount
            :amount="balance(account).amount"
            :currency="account.currency"
            class="text-title-small font-weight-bold"
          />
          <div v-if="balance(account).caption" class="text-label-small text-medium-emphasis">
            {{ balance(account).caption }}
          </div>
        </div>
        <v-btn
          :icon="editing === account.id ? Check : Pencil"
          :disabled="disabled"
          variant="text"
          size="small"
          :aria-label="editing === account.id ? 'Done renaming' : `Rename ${names[account.id]}`"
          data-test="account-picker-rename"
          @click="editing = editing === account.id ? null : account.id"
        />
      </div>
      <v-expand-transition>
        <div v-if="editing === account.id" class="account-picker__rename">
          <v-text-field
            :model-value="names[account.id]"
            label="Name in Cashcove"
            :hint="`The bank calls it ${account.official_name ?? account.name}.`"
            persistent-hint
            :rules="nameRules"
            maxlength="80"
            autofocus
            data-test="account-picker-name-field"
            @update:model-value="rename(account.id, $event)"
            @keydown.enter.prevent="editing = null"
          />
        </div>
      </v-expand-transition>
    </div>
  </div>
</template>

<style scoped>
.account-picker__row {
  padding: 8px 12px 8px 4px;
  margin-bottom: 8px;
  border-radius: 14px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.account-picker__row--selected {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.04);
}

.account-picker__rename {
  padding: 12px 0 4px 52px;
}
</style>
