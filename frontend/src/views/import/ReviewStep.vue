<script setup lang="ts">
import {
  ArrowLeftRight,
  BookmarkCheck,
  CircleAlert,
  Link,
  Plus,
  Sparkles,
  WandSparkles,
} from '@lucide/vue'
import { computed, nextTick, useTemplateRef, watch } from 'vue'

import type { Account } from '@/api/accounts'
import type { ImportPreview, ImportStatement } from '@/api/imports'
import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import { accountType } from '@/components/finance/accountTypes'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useImportWizard } from '@/stores/importWizard'
import { formatDateRange, formatListDate } from '@/utils/dates'
import BalanceChoice from '@/views/import/BalanceChoice.vue'
import { coveredByBank } from '@/views/import/columns'
import { balanceShown, formatIcon, formatName, transactionCount } from '@/views/import/file'
import ReviewRows from '@/views/import/ReviewRows.vue'

/** Choosing the account, the rows to import and what happens to the balance. */
const emit = defineEmits<{ 'add-account': [] }>()

const wizard = useImportWizard()
const accounts = useAccountsStore()
const { locale, money } = useHousehold()

const preview = computed(() => wizard.preview as ImportPreview)

const days = computed(() => {
  const { first_date: start, last_date: end } = preview.value.summary
  return start && end ? formatDateRange({ start, end }, locale.value) : null
})

const about = computed(() =>
  [
    formatName(preview.value.format, preview.value.file_name),
    transactionCount(preview.value.summary.rows),
    days.value,
  ]
    .filter(Boolean)
    .join(' · '),
)

/** What to say under the account: where it came from when the statement said which it is. */
const accountHint = computed(() => {
  if (!wizard.accountId) return 'Choose the account these are from, or add it as a new one.'
  if (wizard.source === 'statement' && wizard.accountId === wizard.suggestedAccount) {
    return 'Matched from the last digits on the statement, here on this computer. Change it if it’s wrong.'
  }
  return undefined
})

/** How many lines of the statement the AI said weren't transactions. */
const leftOut = computed(() => {
  const count = wizard.skipped
  if (!count) return null
  return count === 1
    ? '1 other line looked like a transaction but wasn’t, and was left out.'
    : `${count.toLocaleString('en-US')} other lines looked like transactions but weren’t, and were left out.`
})

function accountDetails(account: Account): string {
  return [
    account.institution,
    account.mask && `•••• ${account.mask}`,
    account.source === 'plaid' ? 'Linked through Plaid' : accountType(account.type).title,
  ]
    .filter(Boolean)
    .join(' · ')
}

function statementTitle(statement: ImportStatement): string {
  return [
    statement.name ?? statement.institution ?? `Statement ${statement.index + 1}`,
    statement.type && accountType(statement.type).title,
    statement.mask && `•••• ${statement.mask}`,
    transactionCount(statement.count),
  ]
    .filter(Boolean)
    .join(' · ')
}

const statements = computed(() =>
  preview.value.statements.map((statement) => ({
    value: statement.index,
    title: statementTitle(statement),
  })),
)

/** Rows on days the bank's own transactions cover start unticked, and this says why. */
const bankNote = computed(() => {
  const history = preview.value.bank_history
  const covered = preview.value.rows.filter(
    (row) => row.status === 'new' && coveredByBank(row, history),
  ).length
  if (!history || !covered) return null
  const { name } = wizard.account as Account
  const rows = covered === 1 ? 'the 1 row' : `the ${covered.toLocaleString('en-US')} rows`
  const start = covered === 1 ? 'starts' : 'start'
  const from = formatListDate(history.start, locale.value)
  if (history.end === null)
    return `Plaid brings in ${name}’s transactions from ${from} on, so ${rows} from then ${start} unticked. Tick any the bank missed.`
  const end = formatListDate(history.end, locale.value)
  return `Plaid brought in ${name}’s transactions from ${from} to ${end}, so ${rows} from those days ${start} unticked.`
})

const possibleDuplicateNote = computed(() => {
  const count = preview.value.summary.possible_duplicates
  if (!count) return null
  const accountName = (wizard.account as Account).name
  if (count === 1) {
    return `1 possible duplicate may already be in ${accountName}. It starts unticked; review it and tick it if it’s a separate transaction.`
  }
  return `${count.toLocaleString('en-US')} possible duplicates may already be in ${accountName}. They start unticked; review each and tick any that are separate transactions.`
})

/** How many of the new rows automations will sort. */
const sortedNote = computed(() => {
  const { sorted } = preview.value.summary
  if (!sorted) return null
  return sorted === 1
    ? 'Your automations will sort 1 of the new transactions as they come in.'
    : `Your automations will sort ${sorted.toLocaleString('en-US')} of the new transactions as they come in.`
})

/** A linked account's balance, which its bank keeps. */
const bankBalance = computed(() => {
  const account = wizard.account as Account
  const { amount, owed } = balanceShown(account.type, account.balance)
  return `${money(amount, account.currency)}${owed ? ' owed' : ''}`
})

// A name another saved format has is only found out on importing, which brings back this
// step; the field comes into view to say so.
const nameField = useTemplateRef<{ focus: () => void }>('nameField')
watch(
  () => wizard.nameError,
  async (error) => {
    if (!error) return
    await nextTick()
    nameField.value?.focus()
  },
  { immediate: true },
)

const saveLabel = computed(() =>
  preview.value.profile_id
    ? `Update the ${wizard.profileName ?? 'saved'} format with these changes`
    : 'Save how this file is read, for the bank’s next files',
)
</script>

<template>
  <div data-test="import-review">
    <div class="review-file d-flex align-center ga-4 px-4 py-3 mb-5" data-test="review-file">
      <v-avatar color="primary" variant="tonal" rounded="lg" size="40" class="flex-shrink-0">
        <v-icon :icon="formatIcon(preview.format)" size="20" />
      </v-avatar>
      <div class="flex-grow-1" style="min-width: 0">
        <div class="text-title-small font-weight-bold text-break">{{ preview.file_name }}</div>
        <div class="text-body-small text-medium-emphasis">{{ about }}</div>
        <div
          v-if="wizard.profileName && !wizard.edited"
          class="d-flex align-center ga-1 text-body-small text-medium-emphasis"
          data-test="review-saved-format"
        >
          <v-icon :icon="BookmarkCheck" size="14" />
          Read with your {{ wizard.profileName }} format
        </div>
      </div>
    </div>

    <v-alert
      v-if="wizard.source === 'statement'"
      :icon="Sparkles"
      color="primary"
      variant="tonal"
      density="compact"
      class="mb-5"
      data-test="review-statement-note"
    >
      <div>
        The AI read these off your PDF. It can get a date, an amount or which way the money went
        wrong, so check each row, and use the pencil to change one.
      </div>
      <div v-if="leftOut" class="mt-1" data-test="review-statement-skipped">{{ leftOut }}</div>
      <!-- Under the words, not beside them, which leaves them a few words wide on a phone. -->
      <v-btn
        variant="text"
        size="small"
        :prepend-icon="ArrowLeftRight"
        :disabled="wizard.refreshing"
        class="mt-2 ms-n3"
        data-test="review-flip"
        @click="wizard.flipSigns()"
      >
        Flip money in and out
      </v-btn>
    </v-alert>

    <v-select
      v-if="statements.length > 1"
      :model-value="preview.statement"
      :items="statements"
      label="Statement"
      :hint="`This file has statements for ${statements.length} accounts. Import them one at a time.`"
      persistent-hint
      class="mb-4"
      data-test="review-statement"
      @update:model-value="wizard.chooseStatement"
    />

    <div class="d-flex flex-column flex-sm-row align-sm-start ga-2 ga-sm-3 mb-2">
      <v-select
        :model-value="wizard.accountId"
        :items="accounts.open"
        item-title="name"
        item-value="id"
        label="Import into"
        placeholder="Choose an account"
        persistent-placeholder
        :hint="accountHint"
        persistent-hint
        class="flex-grow-1"
        data-test="review-account"
        @update:model-value="wizard.chooseAccount"
      >
        <template #selection="{ item }">
          <span class="d-flex align-center ga-2" style="min-width: 0">
            <AccountAvatar :type="item.type" size="24" />
            <span class="text-truncate">{{ item.name }}</span>
          </span>
        </template>
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :subtitle="accountDetails(item)">
            <template #prepend>
              <AccountAvatar :type="item.type" size="32" class="me-3" />
            </template>
          </v-list-item>
        </template>
      </v-select>
      <v-btn
        variant="outlined"
        size="large"
        :prepend-icon="Plus"
        class="review-new-account"
        data-test="review-new-account"
        @click="emit('add-account')"
      >
        New account
      </v-btn>
    </div>

    <template v-if="wizard.account">
      <v-alert
        v-if="possibleDuplicateNote"
        :icon="CircleAlert"
        color="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        :text="possibleDuplicateNote"
        data-test="review-possible-duplicates"
      />

      <v-alert
        v-if="bankNote"
        :icon="Link"
        color="secondary"
        variant="tonal"
        density="compact"
        class="mt-3"
        :text="bankNote"
        data-test="review-bank-history"
      />

      <v-alert
        v-if="sortedNote"
        :icon="WandSparkles"
        color="primary"
        variant="tonal"
        density="compact"
        class="mt-3"
        :text="sortedNote"
        data-test="review-sorted"
      />

      <div class="text-title-small font-weight-bold mt-5 mb-2">Transactions</div>
      <ReviewRows />

      <div class="mt-6">
        <v-alert
          v-if="wizard.linked"
          :icon="Link"
          color="secondary"
          variant="tonal"
          density="compact"
          data-test="review-bank-balance"
        >
          Plaid keeps {{ wizard.account.name }}’s balance up to date, so importing leaves it at
          {{ bankBalance }}.
        </v-alert>
        <BalanceChoice v-else-if="preview.balance" />
      </div>

      <div v-if="wizard.canSave" class="review-save mt-6 pa-4" data-test="review-save">
        <v-checkbox
          v-model="wizard.save"
          :label="saveLabel"
          color="primary"
          density="compact"
          hide-details
          data-test="review-save-toggle"
        />
        <v-expand-transition>
          <div v-if="wizard.save && !preview.profile_id" class="pt-3">
            <v-text-field
              ref="nameField"
              :model-value="wizard.formatName"
              label="Format name"
              hint="The bank’s next file with these columns is read the same way."
              persistent-hint
              counter="80"
              maxlength="80"
              :error-messages="wizard.nameError ?? undefined"
              data-test="review-format-name"
              @update:model-value="wizard.renameFormat"
            />
          </div>
        </v-expand-transition>
      </div>
    </template>
  </div>
</template>

<style scoped>
.review-file,
.review-save {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.review-file {
  background: rgba(var(--v-theme-on-surface), 0.02);
}

/* The same height as the select beside it. */
.review-new-account {
  height: 48px;
}
</style>
