<script setup lang="ts">
import { FileSpreadsheet, Landmark, Link, Pencil, Repeat } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { linkSubscriptionPayments, unlinkSubscriptionPayment } from '@/api/subscriptions'
import { fetchTransaction, updateTransaction, type Transaction } from '@/api/transactions'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useImportsStore } from '@/stores/imports'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { fromIsoDate } from '@/utils/dates'
import { toCents } from '@/utils/money'
import { expectedAmount, frequencyTitle } from '@/views/subscriptions/recurrence'
import { formatShortDate } from '@/utils/format'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  transaction: Transaction | null
  editable?: boolean
}>()
const emit = defineEmits<{
  edit: [transaction: Transaction]
  saved: [transaction: Transaction]
}>()

const accounts = useAccountsStore()
const imports = useImportsStore()
const subscriptions = useSubscriptionsStore()
const { locale, money } = useHousehold()
const displayed = ref<Transaction | null>(null)
const account = computed(() => accounts.find(displayed.value?.account_id))
const importName = computed(() => imports.findImport(displayed.value?.import_id)?.file_name)
const subscriptionName = computed(
  () => subscriptions.find(displayed.value?.subscription_id)?.name ?? 'A subscription',
)
const originalDescription = computed(() => {
  const transaction = displayed.value
  return transaction?.original_description &&
    transaction.original_description.toLowerCase() !== transaction.payee.toLowerCase()
    ? transaction.original_description
    : null
})
const source = computed(() => {
  if (displayed.value?.source === 'plaid') {
    return account.value?.source === 'plaid'
      ? 'Synced from the bank through Plaid'
      : 'From a bank through Plaid'
  }
  return displayed.value?.source === 'file' ? 'Imported from a file' : 'Added manually'
})

const error = computed(() => categorizing.error.value ?? linking.error.value)

/** Only money going out is a payment a subscription can have. */
const isPayment = computed(() => !!displayed.value && toCents(displayed.value.amount) < 0)
const subscriptionItems = computed(() =>
  subscriptions.subscriptions
    .filter((item) => item.active || item.id === displayed.value?.subscription_id)
    .map((item) => ({
      value: item.id,
      title: item.name,
      props: {
        subtitle: `${frequencyTitle(item.frequency)} · ${money(expectedAmount(item), accounts.find(item.account_id)?.currency)}`,
      },
    })),
)

/** Links the transaction to a subscription, moves it or takes it off, e.g. when an automation got it wrong. */
const linking = useAction(async (transaction: Transaction, subscriptionId: string | null) => {
  if (subscriptionId === transaction.subscription_id) return
  if (subscriptionId === null) {
    await unlinkSubscriptionPayment(transaction.subscription_id as string, transaction.id)
    notify('Took it off the subscription')
  } else {
    await linkSubscriptionPayments(subscriptionId, [transaction.id])
    notify(`Linked it to ${subscriptions.find(subscriptionId)?.name ?? 'the subscription'}`)
  }
  // The subscription's category may have changed the transaction's too.
  const saved = await fetchTransaction(transaction.id)
  displayed.value = saved
  emit('saved', saved)
})

const categorizing = useAction(async (transaction: Transaction, categoryId: string | null) => {
  if (categoryId === transaction.category_id) return
  const saved = await updateTransaction(transaction.id, { category_id: categoryId })
  displayed.value = saved
  notify('Saved the category')
  emit('saved', saved)
})

watch(
  [open, () => props.transaction],
  ([isOpen, transaction]) => {
    displayed.value = isOpen ? transaction : null
    if (isOpen && transaction?.import_id) void imports.ensureLoaded()
    // An admin chooses the subscription a payment is for, and anyone is told which it is, among
    // subscriptions that may have been added since they were loaded.
    if (isOpen && transaction) {
      const choosing = props.editable && toCents(transaction.amount) < 0
      const unknown =
        !!transaction.subscription_id && !subscriptions.byId.has(transaction.subscription_id)
      if (choosing || unknown) void subscriptions.load()
    }
    categorizing.clear()
    linking.clear()
  },
  { immediate: true },
)

function changeCategory(transaction: Transaction, categoryId: string | null) {
  if (categorizing.busy.value) return
  void categorizing.run(transaction, categoryId)
}

function changeSubscription(transaction: Transaction, subscriptionId: string | null) {
  if (linking.busy.value) return
  void linking.run(transaction, subscriptionId)
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="displayed?.payee ?? 'Transaction details'"
    :icon="Landmark"
    :persistent="categorizing.busy.value || linking.busy.value"
    max-width="560"
    fullscreen-on-mobile
    data-test="transaction-info-dialog"
  >
    <template v-if="displayed">
      <div class="d-flex align-center ga-3 mb-5">
        <MoneyAmount
          :amount="displayed.amount"
          :currency="account?.currency"
          signed
          class="text-headline-small font-weight-bold"
          :class="{ 'text-medium-emphasis': displayed.pending }"
          data-test="transaction-info-amount"
        />
        <v-chip v-if="displayed.pending" color="warning" variant="tonal" size="small">
          Pending
        </v-chip>
      </div>

      <dl class="transaction-info__details">
        <div class="transaction-info__row">
          <dt>Date</dt>
          <dd>{{ formatShortDate(fromIsoDate(displayed.date), locale) }}</dd>
        </div>
        <div class="transaction-info__row">
          <dt>Account</dt>
          <dd>{{ account?.name ?? 'Deleted account' }}</dd>
        </div>
        <div class="transaction-info__row">
          <dt>Category</dt>
          <dd>
            <CategoryPicker
              v-if="editable"
              :model-value="displayed.category_id"
              label="Category"
              hide-details
              :disabled="categorizing.busy.value"
              data-test="transaction-info-category"
              @update:model-value="(categoryId) => changeCategory(displayed!, categoryId)"
            />
            <CategoryChip v-else :category-id="displayed.category_id" />
          </dd>
        </div>
        <div class="transaction-info__row">
          <dt>Source</dt>
          <dd>
            <span class="d-inline-flex align-center ga-2">
              <v-icon
                v-if="displayed.source === 'plaid'"
                :icon="account?.source === 'plaid' ? Link : Landmark"
                size="16"
              />
              <v-icon v-else-if="displayed.source === 'file'" :icon="FileSpreadsheet" size="16" />
              {{ source }}
            </span>
          </dd>
        </div>
        <div v-if="importName" class="transaction-info__row">
          <dt>File</dt>
          <dd>{{ importName }}</dd>
        </div>
        <div v-if="editable && isPayment" class="transaction-info__row">
          <dt>Subscription</dt>
          <dd>
            <v-select
              :model-value="displayed.subscription_id"
              :items="subscriptionItems"
              label="Subscription"
              placeholder="Not a subscription payment"
              persistent-placeholder
              clearable
              hide-details
              :prepend-inner-icon="Repeat"
              :disabled="linking.busy.value"
              no-data-text="Add a subscription in the Subscriptions tab first"
              data-test="transaction-info-subscription-select"
              @update:model-value="(id: string | null) => changeSubscription(displayed!, id)"
            />
          </dd>
        </div>
        <div v-else-if="displayed.subscription_id" class="transaction-info__row">
          <dt>Subscription</dt>
          <dd>
            <span class="d-inline-flex align-center ga-2" data-test="transaction-info-subscription">
              <v-icon :icon="Repeat" size="16" />
              {{ subscriptionName }}
            </span>
          </dd>
        </div>
        <div v-if="originalDescription" class="transaction-info__row">
          <dt>Original description</dt>
          <dd>{{ originalDescription }}</dd>
        </div>
      </dl>

      <section v-if="displayed.notes" class="mt-5" aria-label="Notes">
        <h3 class="text-label-large font-weight-bold mb-1">Notes</h3>
        <p class="text-body-medium text-medium-emphasis my-0" data-test="transaction-info-notes">
          {{ displayed.notes }}
        </p>
      </section>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="error"
        data-test="transaction-info-error"
      />
    </template>

    <template #actions>
      <v-btn
        v-if="editable && displayed"
        :icon="Pencil"
        variant="text"
        size="small"
        :aria-label="`Edit ${displayed.payee}`"
        data-test="transaction-info-edit"
        @click="emit('edit', displayed)"
      />
      <v-btn color="primary" variant="flat" @click="open = false">Close</v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.transaction-info__details {
  margin: 0;
}

.transaction-info__row {
  display: grid;
  grid-template-columns: minmax(110px, 0.7fr) minmax(0, 1.3fr);
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.transaction-info__row:first-child {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.transaction-info__row dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.transaction-info__row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
