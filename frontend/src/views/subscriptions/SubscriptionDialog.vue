<script setup lang="ts">
import { CalendarClock, Pencil, Repeat } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import { errorMessage } from '@/api/client'
import { recurringApi } from '@/api/recurring'
import { fetchTransactions, type Transaction } from '@/api/transactions'
import type {
  PaymentFrequency,
  RecurringKind,
  Subscription,
  SubscriptionInput,
} from '@/api/subscriptions'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import DateField from '@/components/ui/DateField.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { addDays, formatListDate, todayIso } from '@/utils/dates'
import { negate } from '@/utils/money'
import { kinds, partOf } from '@/views/subscriptions/kinds'
import { frequencies } from '@/views/subscriptions/recurrence'

/**
 * Adds a subscription or a bill, or changes one: they're set up the same way, and it's `kind`
 * that says which this is when adding one. Choosing a payment it was made with links the others
 * like it, and the ones that come later.
 */
const open = defineModel<boolean>({ required: true })
const props = withDefaults(
  defineProps<{ subscription: Subscription | null; kind?: RecurringKind }>(),
  { kind: 'subscription' },
)
const emit = defineEmits<{ saved: [subscription: Subscription] }>()
const accounts = useAccountsStore()
const { locale, money } = useHousehold()
const copy = computed(() => kinds[props.subscription?.kind ?? props.kind])
const part = (name: string) => partOf(props.subscription?.kind ?? props.kind, name)

interface SubscriptionForm {
  name: string
  payee: string
  amount: string | null
  amountVaries: boolean
  frequency: PaymentFrequency
  accountId: string | null
  nextDueDate: string | null
  categoryId: string | null
  notes: string
  active: boolean
  seedTransactionId: string | null
}

const form = reactive<SubscriptionForm>({
  name: '',
  payee: '',
  amount: null as string | null,
  amountVaries: false,
  frequency: 'monthly',
  accountId: null as string | null,
  nextDueDate: null as string | null,
  categoryId: null as string | null,
  notes: '',
  active: true,
  seedTransactionId: null as string | null,
})
const valid = ref(false)
const transactions = ref<Transaction[]>([])
const transactionError = ref<string | null>(null)
const transactionLoading = ref(false)

const account = computed(() => accounts.find(form.accountId))
const accountItems = computed(() => {
  const items = [...accounts.open]
  const current = accounts.find(props.subscription?.account_id)
  if (current && !items.some((item) => item.id === current.id)) items.unshift(current)
  return items.map((item) => ({
    value: item.id,
    title: item.name,
    props: { subtitle: item.institution ?? undefined },
  }))
})
const paymentItems = computed(() =>
  transactions.value.map((transaction) => ({
    value: transaction.id,
    title: `${transaction.payee} · ${formatListDate(transaction.date, locale.value)}`,
    props: {
      subtitle: `${money(negate(transaction.amount), account.value?.currency)} · ${account.value?.name ?? ''}`,
    },
  })),
)
const title = computed(() =>
  props.subscription ? `Edit ${copy.value.noun}` : `Add a ${copy.value.noun}`,
)
const notesRules = [(value: string) => value.length <= 1000 || 'Keep notes under 1,000 characters']
const nameRules = [
  (value: string) => value.trim().length > 0 || `Give this ${copy.value.noun} a name`,
  (value: string) => value.trim().length <= 120 || 'Keep it under 120 characters',
]
const accountRules = [(value: string | null) => !!value || 'Choose an account']
const fieldError = (field: string) => saving.fields.value[field] ?? undefined
const formError = computed(() =>
  Object.keys(saving.fields.value).length ? null : saving.error.value,
)

function reset() {
  const subscription = props.subscription
  form.name = subscription?.name ?? ''
  form.payee = subscription?.payee ?? ''
  form.amount = subscription?.amount ?? null
  form.amountVaries = subscription?.amount_varies ?? false
  form.frequency = subscription?.frequency ?? 'monthly'
  form.accountId = subscription?.account_id ?? accounts.open[0]?.id ?? null
  form.nextDueDate = subscription?.next_due_date ?? addDays(todayIso(), 30)
  form.categoryId = subscription?.category_id ?? null
  form.notes = subscription?.notes ?? ''
  form.active = subscription?.active ?? true
  form.seedTransactionId = null
  transactions.value = []
  transactionError.value = null
  saving.clear()
}

async function loadTransactions() {
  const accountId = form.accountId
  transactions.value = []
  transactionError.value = null
  if (!accountId) return
  transactionLoading.value = true
  try {
    const result = await fetchTransactions({
      account_id: [accountId],
      direction: 'out',
      page_size: 200,
    })
    if (form.accountId === accountId) transactions.value = result.items
  } catch (error) {
    if (form.accountId === accountId) {
      transactionError.value = errorMessage(error)
    }
  } finally {
    if (form.accountId === accountId) transactionLoading.value = false
  }
}

function selectAccount(accountId: string | null) {
  if (accountId === form.accountId) return
  form.accountId = accountId
  form.seedTransactionId = null
  void loadTransactions()
}

function selectTransaction(transactionId: string | null) {
  form.seedTransactionId = transactionId
  if (!transactionId) return
  const transaction = transactions.value.find((item) => item.id === transactionId)
  if (!transaction) return
  form.payee = transaction.payee
  form.amount = negate(transaction.amount)
  // The category the payment already has is the one the others like it should have.
  if (!form.categoryId && transaction.category_id) form.categoryId = transaction.category_id
}

watch(open, (value) => {
  if (value) {
    reset()
    void loadTransactions()
  }
})
watch(form, () => {
  saving.clear()
})

const saving = useAction(async () => {
  const input: SubscriptionInput = {
    name: form.name.trim(),
    payee: form.payee.trim() || form.name.trim(),
    amount: form.amount as string,
    amount_varies: form.amountVaries,
    frequency: form.frequency,
    account_id: form.accountId as string,
    next_due_date: form.nextDueDate as string,
    category_id: form.categoryId,
    notes: form.notes.trim() || null,
    seed_transaction_id: form.seedTransactionId,
  }
  const api = recurringApi(props.subscription?.kind ?? props.kind)
  const subscription = props.subscription
    ? await api.update(props.subscription.id, { ...input, active: form.active })
    : await api.create(input)
  notify(props.subscription ? `Saved the ${copy.value.noun}` : `Added ${subscription.name}`)
  emit('saved', subscription)
  open.value = false
})

function submit() {
  if (valid.value) void saving.run()
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="title"
    :subtitle="copy.dialogSubtitle"
    :icon="subscription ? Pencil : copy.icon"
    :persistent="saving.busy.value"
    max-width="640"
    fullscreen-on-mobile
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <v-row density="compact">
        <v-col cols="12" sm="7">
          <v-text-field
            v-model="form.name"
            :label="copy.nameLabel"
            :rules="nameRules"
            :error-messages="fieldError('name')"
            autocomplete="off"
            required
            :data-test="part('name')"
          />
        </v-col>
        <v-col cols="12" sm="5">
          <MoneyField
            v-model="form.amount"
            :label="form.amountVaries ? 'Estimated amount' : 'Payment amount'"
            :currency="account?.currency"
            required
            non-zero
            :error-messages="fieldError('amount')"
            :data-test="part('amount')"
          />
        </v-col>
        <v-col cols="12">
          <v-switch
            v-model="form.amountVaries"
            label="The amount changes every time, like an electricity bill"
            hint="Cashcove uses the average of recent payments once there are some, and the estimate until then."
            persistent-hint
            color="primary"
            :data-test="part('varies')"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="form.frequency"
            :items="frequencies"
            label="Payment frequency"
            :prepend-inner-icon="Repeat"
            :data-test="part('frequency')"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <DateField
            v-model="form.nextDueDate"
            :label="copy.dueLabel"
            required
            :error-messages="fieldError('next_due_date')"
            :data-test="part('due-date')"
          />
        </v-col>
        <v-col cols="12">
          <v-select
            :model-value="form.accountId"
            :items="accountItems"
            label="Payment account"
            :prepend-inner-icon="CalendarClock"
            :rules="accountRules"
            :error-messages="fieldError('account_id')"
            no-data-text="Add an account in the Accounts tab first"
            :data-test="part('account')"
            @update:model-value="selectAccount"
          />
        </v-col>
        <v-col cols="12">
          <v-text-field
            v-model="form.payee"
            label="Match transactions with this payee"
            :hint="`Leave blank to match the ${copy.noun} name; letter case is ignored. Other spellings? An automation can match those too.`"
            persistent-hint
            :error-messages="fieldError('payee')"
            autocomplete="off"
            :data-test="part('payee')"
          />
        </v-col>
        <v-col cols="12">
          <v-autocomplete
            :model-value="form.seedTransactionId"
            :items="paymentItems"
            :loading="transactionLoading"
            label="Link a past payment (optional)"
            hint="Matching this payment links other and future payments from this account."
            persistent-hint
            clearable
            no-data-text="No outgoing transactions found for this account"
            :error-messages="transactionError"
            :data-test="part('seed-transaction')"
            @update:model-value="selectTransaction"
          />
        </v-col>
        <v-col cols="12">
          <CategoryPicker
            v-model="form.categoryId"
            label="Transaction category"
            :error-messages="fieldError('category_id')"
            :data-test="part('category')"
          />
        </v-col>
        <v-col cols="12">
          <v-textarea
            v-model="form.notes"
            label="Notes"
            hint="Optional"
            rows="2"
            auto-grow
            counter="1000"
            :rules="notesRules"
            :error-messages="fieldError('notes')"
            :data-test="part('notes')"
          />
        </v-col>
      </v-row>
      <v-switch
        v-if="subscription"
        v-model="form.active"
        label="Automatically track matching payments"
        color="primary"
        hide-details
        :data-test="part('active')"
      />
      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="formError"
        :data-test="part('error')"
      />
      <button type="submit" hidden />
    </v-form>
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!valid"
        :data-test="part('save')"
        @click="submit"
      >
        {{ subscription ? 'Save changes' : `Add ${copy.noun}` }}
      </v-btn>
    </template>
  </AppDialog>
</template>
