<script setup lang="ts">
import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  FileSpreadsheet,
  Landmark,
  Link,
  Pencil,
  Plus,
  Trash2,
} from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import type { Account } from '@/api/accounts'
import {
  createTransaction,
  deleteTransaction,
  updateTransaction,
  type PayeeSuggestion,
  type Transaction,
} from '@/api/transactions'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import DateField from '@/components/ui/DateField.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { addDays, todayIso } from '@/utils/dates'
import { fromCents, negate, toCents } from '@/utils/money'
import PayeeField from '@/views/transactions/PayeeField.vue'

/**
 * Adds a transaction by hand, or edits or deletes one. Viewers see its details. Plaid keeps
 * the date, amount and account of what it synced, so those can't change here.
 */
const open = defineModel<boolean>({ required: true })
const props = withDefaults(
  defineProps<{
    transaction: Transaction | null
    /** Where a new transaction goes unless changed. */
    defaultAccount?: string | null
    readonly?: boolean
  }>(),
  { defaultAccount: null, readonly: false },
)
const emit = defineEmits<{
  saved: [transaction: Transaction]
  deleted: [transaction: Transaction]
}>()

const accounts = useAccountsStore()
const { money } = useHousehold()

interface TransactionForm {
  direction: 'in' | 'out'
  /** Always positive; the direction says which way the money went. */
  amount: string | null
  date: string | null
  payee: string
  categoryId: string | null
  accountId: string | null
  notes: string
}

const form = reactive<TransactionForm>({
  direction: 'out',
  amount: null,
  date: null,
  payee: '',
  categoryId: null,
  accountId: null,
  notes: '',
})
const valid = ref(false)

const fromBank = computed(() => props.transaction?.source === 'plaid')
const locked = computed(() => props.readonly || fromBank.value)
const account = computed(() => accounts.find(form.accountId))
const original = computed(() => accounts.find(props.transaction?.account_id))

/** Accounts kept by hand, plus the transaction's own, which may be closed or linked. */
const accountItems = computed(() => {
  const items: Account[] = [...accounts.manual]
  if (original.value && !items.includes(original.value)) items.unshift(original.value)
  return items.map((item) => ({
    value: item.id,
    title: item.name,
    props: {
      subtitle: [item.institution, item.mask && `•••• ${item.mask}`].filter(Boolean).join(' · '),
      disabled: item.source !== 'manual' || !!item.closed_at,
    },
  }))
})

const title = computed(() => {
  if (props.readonly) return 'Transaction details'
  return props.transaction ? 'Edit transaction' : 'Add a transaction'
})

function reset() {
  const transaction = props.transaction
  const amount = transaction?.amount ?? null
  form.direction = amount && toCents(amount) > 0 ? 'in' : 'out'
  form.amount = amount && toCents(amount) < 0 ? negate(amount) : amount
  form.date = transaction?.date ?? todayIso()
  form.payee = transaction?.payee ?? ''
  form.categoryId = transaction?.category_id ?? null
  form.accountId = transaction?.account_id ?? props.defaultAccount ?? accounts.manual[0]?.id ?? null
  form.notes = transaction?.notes ?? ''
  saving.clear()
}

watch(open, (value) => {
  if (value) reset()
})

/** An amount with its sign: money out is negative. */
function withSign(amount: string): string {
  return form.direction === 'out' ? negate(amount) : amount
}

/** How a manual account's balance changes when this is saved. */
const balanceHint = computed(() => {
  const target = account.value
  if (!target || target.source !== 'manual' || locked.value || !form.amount) return null
  const before = props.transaction?.account_id === target.id ? props.transaction.amount : '0'
  const change = toCents(withSign(form.amount)) - toCents(before)
  if (change === 0) return null
  const after = fromCents(toCents(target.balance) + change)
  return `${target.name} goes from ${money(target.balance, target.currency)} to ${money(after, target.currency)}.`
})

/** A payee used before brings its category along, unless one is chosen already. */
function picked(suggestion: PayeeSuggestion) {
  if (!form.categoryId && suggestion.category_id) form.categoryId = suggestion.category_id
}

const saving = useAction(async () => {
  const transaction = props.transaction
  const notes = form.notes.trim() || null
  const common = { payee: form.payee.trim(), category_id: form.categoryId, notes }
  const details = {
    ...common,
    account_id: form.accountId as string,
    date: form.date as string,
    amount: withSign(form.amount as string),
  }
  // The bank keeps its own transactions' account, date and amount.
  const changes = fromBank.value ? common : details
  const saved = transaction
    ? await updateTransaction(transaction.id, changes)
    : await createTransaction(details)
  notify(transaction ? 'Saved the transaction' : `Added ${saved.payee}`)
  emit('saved', saved)
  open.value = false
})

// What the API rejected no longer applies once the form changes, so it can be sent again.
watch(form, () => {
  saving.clear()
})

function submit() {
  if (valid.value && !props.readonly) void saving.run()
}

async function remove() {
  const transaction = props.transaction as Transaction
  const done = await confirmAndRun(
    {
      title: `Delete ${transaction.payee}?`,
      text:
        original.value?.source === 'manual'
          ? `${original.value.name}'s balance moves back by its amount. This can't be undone.`
          : "This can't be undone.",
      confirmText: 'Delete transaction',
      tone: 'error',
      icon: Trash2,
    },
    () => deleteTransaction(transaction.id),
  )
  if (!done) return
  notify('Deleted the transaction')
  emit('deleted', transaction)
  open.value = false
}

const maxDate = addDays(todayIso(), 366)
const notesRules = [(value: string) => value.length <= 1000 || 'Keep notes under 1,000 characters']
const accountRules = [(value: string | null) => !!value || 'Choose an account']
const fieldError = (field: string) => saving.fields.value[field] ?? undefined
const formError = computed(() =>
  Object.keys(saving.fields.value).length ? null : saving.error.value,
)
</script>

<template>
  <AppDialog
    v-model="open"
    :title="title"
    :icon="readonly ? Eye : transaction ? Pencil : Plus"
    :persistent="saving.busy.value"
    max-width="600"
    fullscreen-on-mobile
  >
    <v-alert
      v-if="fromBank"
      :icon="Link"
      color="secondary"
      variant="tonal"
      density="compact"
      class="mb-5"
      data-test="transaction-from-bank"
    >
      <div>From the bank through Plaid, which keeps its date, amount and account up to date.</div>
      <div v-if="transaction?.original_description" class="text-body-small mt-1">
        The bank calls it “{{ transaction.original_description }}”.
      </div>
    </v-alert>
    <v-alert
      v-else-if="transaction?.source === 'file'"
      :icon="FileSpreadsheet"
      color="secondary"
      variant="tonal"
      density="compact"
      class="mb-5"
      data-test="transaction-from-file"
    >
      Imported from a file.
    </v-alert>

    <v-form v-model="valid" :readonly="readonly" @submit.prevent="submit">
      <div class="d-flex flex-wrap align-center ga-3 mb-4">
        <v-btn-toggle
          v-model="form.direction"
          mandatory
          divided
          variant="outlined"
          density="comfortable"
          :disabled="locked"
          color="primary"
          aria-label="Direction"
          data-test="transaction-direction"
        >
          <v-btn value="out" :prepend-icon="ArrowUpRight">Money out</v-btn>
          <v-btn value="in" :prepend-icon="ArrowDownLeft">Money in</v-btn>
        </v-btn-toggle>
        <v-chip
          v-if="transaction?.pending"
          color="warning"
          variant="tonal"
          size="small"
          data-test="transaction-pending"
        >
          Pending
        </v-chip>
      </div>

      <v-row dense>
        <v-col cols="12" sm="6">
          <MoneyField
            v-model="form.amount"
            label="Amount"
            :currency="account?.currency"
            required
            non-zero
            :disabled="locked"
            :error-messages="fieldError('amount')"
            data-test="transaction-amount"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <DateField
            v-model="form.date"
            label="Date"
            min="1970-01-01"
            :max="maxDate"
            required
            :disabled="locked"
            :error-messages="fieldError('date')"
            data-test="transaction-date"
          />
        </v-col>
        <v-col cols="12">
          <PayeeField
            v-model="form.payee"
            :error-messages="fieldError('payee')"
            data-test="transaction-payee"
            @picked="picked"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <CategoryPicker
            v-model="form.categoryId"
            :error-messages="fieldError('category_id')"
            data-test="transaction-category"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="form.accountId"
            :items="accountItems"
            label="Account"
            :prepend-inner-icon="Landmark"
            :rules="accountRules"
            :disabled="locked"
            :error-messages="fieldError('account_id')"
            no-data-text="Add an account in the Accounts tab first"
            data-test="transaction-account"
          />
        </v-col>
      </v-row>

      <v-textarea
        v-model="form.notes"
        label="Notes"
        hint="Optional"
        rows="2"
        auto-grow
        counter="1000"
        :rules="notesRules"
        :error-messages="fieldError('notes')"
        data-test="transaction-notes"
      />

      <p
        v-if="balanceHint"
        class="text-body-small text-medium-emphasis mt-2 mb-0"
        data-test="transaction-balance-hint"
      >
        {{ balanceHint }}
      </p>

      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="formError"
        data-test="transaction-error"
      />
      <!-- Lets Enter submit the form. -->
      <button type="submit" hidden />
    </v-form>

    <template #actions>
      <template v-if="readonly">
        <v-btn color="primary" variant="flat" @click="open = false">Close</v-btn>
      </template>
      <template v-else>
        <v-btn
          v-if="transaction"
          color="error"
          variant="text"
          :prepend-icon="Trash2"
          :disabled="saving.busy.value"
          class="me-auto"
          data-test="transaction-delete"
          @click="remove"
        >
          Delete
        </v-btn>
        <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving.busy.value"
          :disabled="!valid"
          data-test="transaction-save"
          @click="submit"
        >
          {{ transaction ? 'Save changes' : 'Add transaction' }}
        </v-btn>
      </template>
    </template>
  </AppDialog>
</template>
