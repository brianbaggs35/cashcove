<script setup lang="ts">
import { ArrowRight, EllipsisVertical, Eye, Link2, ReceiptText, Unlink } from '@lucide/vue'
import { computed, ref, shallowRef, watch } from 'vue'

import { errorMessage } from '@/api/client'
import type { PaymentPoint, PaymentSummary, Subscription } from '@/api/subscriptions'
import { fetchTransactions, type Transaction } from '@/api/transactions'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { unlinkPayment } from '@/composables/useRecurringActions'
import { useAccountsStore } from '@/stores/accounts'
import { fromIsoDate } from '@/utils/dates'
import { formatCount, formatShortDate } from '@/utils/format'
import { negate } from '@/utils/money'
import TransactionInfoDialog from '@/views/transactions/TransactionInfoDialog.vue'
import PaymentChart from '@/views/subscriptions/PaymentChart.vue'
import { kinds } from '@/views/subscriptions/kinds'

/**
 * The payments linked to a subscription or a bill: what they came to, what each cost, and the
 * payments themselves, a page at a time. Opening one tells all there is to know of it, and an
 * admin can take one off.
 */
const props = defineProps<{
  subscription: Subscription
  summary: PaymentSummary
  /** The latest payments for the chart, the earliest first. */
  history: PaymentPoint[]
  readonly: boolean
  /** Changes whenever the page has loaded its subscription afresh, so the payments follow. */
  refresh: number
}>()
const emit = defineEmits<{ link: []; changed: [] }>()

/** How many payments are listed at a time. */
const PAGE_SIZE = 10

const accounts = useAccountsStore()
const { money, locale } = useHousehold()
const copy = computed(() => kinds[props.subscription.kind])
const currency = computed(() => accounts.find(props.subscription.account_id)?.currency)

const payments = ref<Transaction[]>([])
const total = ref(0)
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const details = ref(false)
const selected = shallowRef<Transaction | null>(null)
let request = 0

async function load(page: number) {
  const current = ++request
  loading.value = true
  error.value = null
  try {
    const result = await fetchTransactions({
      subscription_id: props.subscription.id,
      sort: '-date',
      page,
      page_size: PAGE_SIZE,
    })
    if (current !== request) return
    payments.value = page === 1 ? result.items : [...payments.value, ...result.items]
    total.value = result.total
    loaded.value = true
  } catch (loadError) {
    if (current === request) error.value = errorMessage(loadError)
  } finally {
    if (current === request) loading.value = false
  }
}

watch(
  () => [props.subscription.id, props.refresh],
  () => void load(1),
  { immediate: true },
)

const more = computed(() => payments.value.length < total.value)
const none = computed(() => loaded.value && total.value === 0)
const nextPage = computed(() => Math.floor(payments.value.length / PAGE_SIZE) + 1)

const rows = computed(() =>
  payments.value.map((payment) => {
    const account = accounts.find(payment.account_id)
    return {
      payment,
      date: formatShortDate(fromIsoDate(payment.date), locale.value),
      account: account?.name ?? 'Account unavailable',
      amount: money(negate(payment.amount), account?.currency),
    }
  }),
)

const figures = computed(() => [
  { key: 'this-year', label: 'This year', value: props.summary.this_year },
  { key: 'average', label: 'Average', value: props.summary.average },
  { key: 'highest', label: 'Highest', value: props.summary.highest },
  { key: 'lowest', label: 'Lowest', value: props.summary.lowest },
])

function show(payment: Transaction) {
  selected.value = payment
  details.value = true
}

/** Asks first, and has the page load it afresh if the payment came off. */
async function unlink(payment: Transaction) {
  if (await unlinkPayment(props.subscription, payment)) emit('changed')
}
</script>

<template>
  <v-card data-test="subscription-payments">
    <v-card-text class="pa-5">
      <header class="d-flex align-center flex-wrap ga-2 mb-4">
        <v-icon :icon="ReceiptText" size="20" class="text-medium-emphasis" aria-hidden="true" />
        <h2 class="text-title-medium font-weight-bold ma-0 flex-grow-1">
          Payments
          <span class="text-body-medium text-medium-emphasis font-weight-regular">
            · {{ formatCount(subscription.payment_count, 'payment', locale) }}
          </span>
        </h2>
        <v-btn
          v-if="!readonly"
          variant="tonal"
          size="small"
          color="primary"
          :prepend-icon="Link2"
          data-test="payments-link"
          @click="emit('link')"
        >
          Link payments
        </v-btn>
        <v-btn
          :to="{ name: 'transactions', query: { subscription: subscription.id } }"
          variant="text"
          size="small"
          color="primary"
          :append-icon="ArrowRight"
          data-test="payments-view-all"
        >
          View in Transactions
        </v-btn>
      </header>

      <template v-if="subscription.payment_count">
        <div class="figures-box mb-6">
          <dl class="figures" data-test="payment-figures">
            <template v-for="figure in figures" :key="figure.key">
              <div v-if="figure.value !== null" class="figures__item">
                <dt class="text-body-small text-medium-emphasis">{{ figure.label }}</dt>
                <dd class="text-title-medium font-weight-bold tabular-nums ma-0">
                  {{ money(figure.value, currency) }}
                </dd>
              </div>
            </template>
          </dl>
        </div>
        <PaymentChart
          v-if="history.length > 1"
          :history="history"
          :currency="currency"
          class="mb-5"
        />
      </template>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        :text="error"
        data-test="payments-error"
      >
        <template #append>
          <v-btn variant="text" size="small" data-test="payments-retry" @click="load(1)">
            Try again
          </v-btn>
        </template>
      </v-alert>

      <v-skeleton-loader
        v-if="loading && !loaded"
        type="list-item-two-line@3"
        data-test="payments-loading"
      />
      <EmptyState
        v-else-if="none"
        compact
        :icon="ReceiptText"
        title="No payments yet"
        :text="`Payments to ${subscription.payee} from this account are linked as they arrive. You can also link payments from any account.`"
      >
        <v-btn
          v-if="!readonly"
          color="primary"
          variant="flat"
          :prepend-icon="Link2"
          data-test="payments-link-first"
          @click="emit('link')"
        >
          Link payments
        </v-btn>
      </EmptyState>
      <template v-else-if="loaded">
        <ul class="payments pa-0 ma-0" :aria-label="`Payments linked to this ${copy.noun}`">
          <li v-for="row in rows" :key="row.payment.id" class="payment" data-test="payment-item">
            <button
              type="button"
              class="payment__main"
              aria-haspopup="dialog"
              data-test="payment-open"
              @click="show(row.payment)"
            >
              <span class="payment__what">
                <span class="text-body-medium font-weight-medium text-truncate">
                  {{ row.payment.payee }}
                </span>
                <span class="text-body-small text-medium-emphasis text-truncate">
                  {{ row.date }} · {{ row.account }}
                </span>
              </span>
              <v-chip v-if="row.payment.pending" size="x-small" color="warning" variant="tonal">
                Pending
              </v-chip>
              <span class="tabular-nums font-weight-medium">{{ row.amount }}</span>
            </button>
            <v-menu v-if="!readonly" location="bottom end">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  :icon="EllipsisVertical"
                  variant="text"
                  size="small"
                  :aria-label="`Actions for ${row.payment.payee} on ${row.date}`"
                  data-test="payment-actions"
                />
              </template>
              <v-list density="compact" nav min-width="200">
                <v-list-item
                  :prepend-icon="Eye"
                  title="View details"
                  data-test="payment-details"
                  @click="show(row.payment)"
                />
                <v-list-item
                  :prepend-icon="Unlink"
                  title="Unlink payment"
                  base-color="error"
                  data-test="payment-unlink"
                  @click="unlink(row.payment)"
                />
              </v-list>
            </v-menu>
          </li>
        </ul>
        <div v-if="more" class="d-flex justify-center mt-3">
          <v-btn
            variant="tonal"
            size="small"
            :loading="loading"
            data-test="payments-more"
            @click="load(nextPage)"
          >
            Show older payments
          </v-btn>
        </div>
      </template>
    </v-card-text>

    <TransactionInfoDialog v-model="details" :transaction="selected" />
  </v-card>
</template>

<style scoped>
/* Two by two, and four in a row only when the card is wide enough to hold them. */
.figures-box {
  container-type: inline-size;
}

.figures {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

@container (min-width: 560px) {
  .figures {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.figures__item {
  padding: 10px 14px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.payments {
  display: grid;
  gap: 8px;
  list-style: none;
}

.payment {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.payment__main {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 14px;
  color: inherit;
  text-align: start;
  background: transparent;
  border: 0;
  border-radius: 14px;
  cursor: pointer;
}

.payment__main:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.payment__main:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.payment__what {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.payment > :last-child:not(.payment__main) {
  margin-inline-end: 4px;
}
</style>
