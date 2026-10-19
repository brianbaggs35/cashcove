<script setup lang="ts">
import { Link2, SearchX, Unlink } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { errorMessage } from '@/api/client'
import { recurringApi } from '@/api/recurring'
import type { Subscription } from '@/api/subscriptions'
import type { Transaction } from '@/api/transactions'
import TransactionFinder from '@/components/finance/TransactionFinder.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { notify } from '@/composables/notify'
import { useHousehold } from '@/composables/useHousehold'
import { unlinkPayment } from '@/composables/useRecurringActions'
import { useAccountsStore } from '@/stores/accounts'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { fromIsoDate } from '@/utils/dates'
import { formatCount, formatShortDate } from '@/utils/format'
import { negate, sumAmounts } from '@/utils/money'
import { kinds } from '@/views/subscriptions/kinds'
import { paysAgain } from '@/views/subscriptions/recurrence'

/**
 * Links payments, from any account, to a subscription or a bill and takes them off again. It
 * starts with the payments that look like it, which are ticked and linked together, and has the
 * ones already linked in a list of their own to take off. Linked payments count toward it, take
 * its category and settle its next due date.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ subscription: Subscription | null }>()
const emit = defineEmits<{ changed: [subscription: Subscription] }>()

const subscriptions = useSubscriptionsStore()
const accounts = useAccountsStore()
const { locale, money } = useHousehold()

const current = ref<Subscription | null>(props.subscription)
const copy = computed(() => kinds[props.subscription?.kind ?? 'subscription'])
const scope = ref<'all' | 'linked'>('all')
/** Counts openings, so each starts with a fresh list. */
const openings = ref(0)
const query = ref('')
const picked = ref<Transaction[]>([])
/** The payment being taken off, and whether the picked ones are being linked. */
const busy = ref<string | null>(null)
const linking = ref(false)
/** The finder's `reload`, to list payments afresh after one changed. */
const finder = ref<{ reload: () => Promise<void> } | null>(null)

/** What to start searching for: what it is paid to, which finds the payments that look like it. */
const lookingFor = computed(() => props.subscription?.payee ?? '')

watch(
  () => props.subscription,
  (subscription) => {
    current.value = subscription
  },
)
watch(open, (value) => {
  if (!value) return
  openings.value++
  scope.value = 'all'
  query.value = lookingFor.value
  picked.value = []
  current.value = props.subscription
  // Names the other subscriptions payments are linked to.
  void subscriptions.load()
})
// Taking payments off starts with all of them; finding more starts with ones that look like it.
watch(scope, (value) => {
  query.value = value === 'all' ? lookingFor.value : ''
})

function summaryOf(subscription: Subscription): string {
  const linked = `${formatCount(subscription.payment_count, 'payment', locale.value)} linked.`
  const due = formatShortDate(fromIsoDate(subscription.next_due_date), locale.value)
  if (subscription.ends_on && !paysAgain(subscription)) {
    const ends = formatShortDate(fromIsoDate(subscription.ends_on), locale.value)
    return `${linked} No more payments are due: it ends on ${ends}.`
  }
  return `${linked} Next payment due ${due}.`
}

const isPicked = (transaction: Transaction) =>
  picked.value.some((item) => item.id === transaction.id)
/** What a payment is already linked to, which can only be another subscription or bill here. */
function linkedElsewhere(transaction: Transaction): string | null {
  if (!transaction.subscription_id) return null
  return subscriptions.find(transaction.subscription_id)?.name ?? 'another subscription or bill'
}

const searching = computed(() => query.value !== '' && query.value === lookingFor.value)
const amountOf = (transaction: Transaction) =>
  money(negate(transaction.amount), accounts.find(transaction.account_id)?.currency)
/** What the chosen payments come to, when they are all in one currency: otherwise it means nothing. */
const pickedTotal = computed(() => {
  const currencies = new Set(
    picked.value.map((transaction) => accounts.find(transaction.account_id)?.currency),
  )
  if (currencies.size > 1) return null
  const [currency] = currencies
  return money(sumAmounts(picked.value.map((transaction) => negate(transaction.amount))), currency)
})

function toggle(transaction: Transaction) {
  picked.value = isPicked(transaction)
    ? picked.value.filter((item) => item.id !== transaction.id)
    : [...picked.value, transaction]
}

async function linkPicked() {
  const subscription = current.value as Subscription
  const chosen = picked.value
  linking.value = true
  try {
    const result = await recurringApi(subscription.kind).link(
      subscription.id,
      chosen.map((transaction) => transaction.id),
    )
    current.value = result.subscription
    picked.value = []
    notify(
      chosen.length === 1
        ? `Linked ${(chosen[0] as Transaction).payee} to ${subscription.name}`
        : `Linked ${chosen.length} payments to ${subscription.name}`,
    )
    emit('changed', current.value)
    await finder.value?.reload()
  } catch (linkError) {
    notify(`Couldn't link the payments. ${errorMessage(linkError)}`, 'error')
  } finally {
    linking.value = false
  }
}

/** Takes a payment off, once the person has confirmed it. */
async function unlink(transaction: Transaction) {
  const subscription = current.value as Subscription
  busy.value = transaction.id
  try {
    const unlinked = await unlinkPayment(subscription, transaction)
    if (!unlinked) return
    current.value = unlinked
    emit('changed', unlinked)
    await finder.value?.reload()
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="`Link payments to ${subscription?.name ?? `a ${copy.noun}`}`"
    :subtitle="`Linked payments count toward the ${copy.noun}, take its category and settle its next due date.`"
    :icon="Link2"
    max-width="720"
    fullscreen-on-mobile
    :persistent="linking"
    :data-test="`${copy.noun}-payments-dialog`"
  >
    <template v-if="current">
      <div class="d-flex flex-wrap align-center justify-space-between ga-3 mb-4">
        <p class="text-body-medium ma-0" data-test="payments-summary">
          {{ summaryOf(current) }}
        </p>
        <v-btn-toggle
          v-model="scope"
          mandatory
          divided
          variant="outlined"
          color="primary"
          density="comfortable"
          aria-label="Which payments to list"
          data-test="payments-scope"
        >
          <v-btn value="all">Find payments</v-btn>
          <v-btn value="linked">Linked here</v-btn>
        </v-btn-toggle>
      </div>
      <TransactionFinder
        :key="`${openings}-${scope}`"
        ref="finder"
        v-model:search="query"
        direction="out"
        :subscription-id="scope === 'linked' ? current.id : null"
        :not-subscription-id="scope === 'all' ? current.id : null"
      >
        <template v-if="searching && scope === 'all'" #hint>
          <p class="text-body-small text-medium-emphasis ma-0" data-test="payments-hint">
            Showing payments that look like “{{ query }}”. Search for something else, or clear the
            search to see every payment not linked here.
          </p>
        </template>
        <template #empty>
          <EmptyState
            compact
            :icon="SearchX"
            :title="scope === 'linked' ? 'Nothing is linked yet' : 'No payments found'"
            :text="
              scope === 'linked'
                ? `Find payments to link to this ${copy.noun}.`
                : 'Try a different search, or clear it to see them all.'
            "
          >
            <v-btn
              v-if="scope === 'linked'"
              variant="tonal"
              color="primary"
              data-test="payments-find"
              @click="scope = 'all'"
            >
              Find payments
            </v-btn>
            <v-btn v-else-if="query" variant="tonal" data-test="payments-clear" @click="query = ''">
              Show every payment
            </v-btn>
          </EmptyState>
        </template>
        <template #row="{ transaction, description }">
          <div
            v-if="scope === 'all'"
            class="pay"
            :class="{ 'pay--picked': isPicked(transaction) }"
            data-test="payment-row"
          >
            <v-checkbox
              :model-value="isPicked(transaction)"
              :disabled="linking"
              color="primary"
              hide-details
              :data-test="`payment-select-${transaction.id}`"
              @update:model-value="toggle(transaction)"
            >
              <template #label>
                <span class="pay__label">
                  <span class="pay__text">
                    <span class="pay__payee">{{ transaction.payee }}</span>
                    <span class="pay__meta">{{ description }}</span>
                    <span v-if="linkedElsewhere(transaction)">
                      <v-chip size="x-small" variant="tonal" data-test="payment-elsewhere">
                        Linked to {{ linkedElsewhere(transaction) }} · moves here
                      </v-chip>
                    </span>
                  </span>
                  <span class="pay__amount">{{ amountOf(transaction) }}</span>
                </span>
              </template>
            </v-checkbox>
          </div>
          <div v-else class="pay pay--linked" data-test="payment-row">
            <span class="pay__label pay__label--plain">
              <span class="pay__text">
                <span class="pay__payee">{{ transaction.payee }}</span>
                <span class="pay__meta">{{ description }}</span>
              </span>
              <span class="pay__amount">{{ amountOf(transaction) }}</span>
              <v-btn
                variant="tonal"
                color="error"
                size="small"
                :prepend-icon="Unlink"
                :loading="busy === transaction.id"
                :aria-label="`Unlink ${transaction.payee} on ${formatShortDate(fromIsoDate(transaction.date), locale)}`"
                :data-test="`payment-unlink-${transaction.id}`"
                @click="unlink(transaction)"
              >
                Unlink
              </v-btn>
            </span>
          </div>
        </template>
      </TransactionFinder>
    </template>
    <template #actions>
      <template v-if="scope === 'all' && picked.length">
        <p class="pay__picked text-body-medium ma-0 me-auto" data-test="payments-picked">
          {{ formatCount(picked.length, 'payment', locale) }} chosen<template v-if="pickedTotal">
            · {{ pickedTotal }}</template
          >
        </p>
        <v-btn
          variant="text"
          :disabled="linking"
          data-test="payments-clear-picked"
          @click="picked = []"
        >
          Clear
        </v-btn>
      </template>
      <v-btn variant="text" :disabled="linking" data-test="payments-done" @click="open = false">
        Done
      </v-btn>
      <v-btn
        v-if="scope === 'all' && picked.length"
        color="primary"
        variant="flat"
        :prepend-icon="Link2"
        :loading="linking"
        data-test="payments-link-selected"
        @click="linkPicked"
      >
        Link {{ picked.length === 1 ? 'payment' : `${picked.length} payments` }}
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.pay {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}

.pay:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.pay--linked {
  background: rgba(var(--v-theme-success), 0.07);
}

.pay--picked {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.55);
}

/* The label is the whole row, so pressing anywhere on it ticks the payment. */
.pay :deep(.v-input__control) {
  width: 100%;
}

.pay :deep(.v-selection-control) {
  align-items: center;
  width: 100%;
  padding: 6px 12px 6px 4px;
}

.pay :deep(.v-label) {
  flex: 1 1 auto;
  min-width: 0;
  opacity: 1;
  white-space: normal;
}

.pay__label {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.pay__label--plain {
  padding: 10px 12px 10px 16px;
}

.pay__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.pay__payee {
  font-weight: 500;
  overflow-wrap: anywhere;
}

.pay__meta {
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.pay__amount {
  flex-shrink: 0;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pay__picked {
  font-variant-numeric: tabular-nums;
}

/* On a phone the total gets a line of its own, over the buttons. */
@media (max-width: 599px) {
  .pay__picked {
    flex: 1 0 100%;
  }
}
</style>
