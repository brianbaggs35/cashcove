<script setup lang="ts">
import {
  CalendarClock,
  CirclePause,
  EllipsisVertical,
  Landmark,
  Link2,
  Pencil,
  Repeat,
  Trash2,
} from '@lucide/vue'
import { computed } from 'vue'

import type { Subscription } from '@/api/subscriptions'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import { toCents } from '@/utils/money'
import { estimatedAmount, expectedAmount, frequencyTitle } from '@/views/subscriptions/recurrence'

const props = withDefaults(
  defineProps<{
    subscription: Subscription
    daysUntilDue: number
    alertDays: number
    dueAlertsEnabled: boolean
    readonly?: boolean
  }>(),
  { readonly: false },
)
const emit = defineEmits<{
  edit: [subscription: Subscription]
  delete: [subscription: Subscription]
  toggle: [subscription: Subscription]
  link: [subscription: Subscription]
  'update-amount': [subscription: Subscription]
}>()

const accounts = useAccountsStore()
const household = useHousehold()
const account = computed(() => accounts.find(props.subscription.account_id))
const overdue = computed(() => props.daysUntilDue < 0)
const dueText = computed(() => {
  if (overdue.value) {
    const days = Math.abs(props.daysUntilDue)
    return `Overdue by ${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (props.daysUntilDue === 0) return 'Due today'
  if (props.daysUntilDue === 1) return 'Due tomorrow'
  return `Due ${formatShortDate(fromIsoDate(props.subscription.next_due_date), household.locale.value)}`
})
/** When the latest payment was made and for how much, in a line. */
const lastPayment = computed(() => {
  const { last_payment_on: on, last_payment_amount: amount } = props.subscription
  if (!on) return null
  const when = formatShortDate(fromIsoDate(on), household.locale.value)
  return amount
    ? `Last payment ${when} · ${household.money(amount, account.value?.currency)}`
    : `Last payment ${when}`
})
const inAlertWindow = computed(
  () => props.dueAlertsEnabled && props.daysUntilDue >= 0 && props.daysUntilDue <= props.alertDays,
)
const expected = computed(() => expectedAmount(props.subscription))
const monthlyAmount = computed(() =>
  estimatedAmount(expected.value, props.subscription.frequency, 'month'),
)
/** A payment that isn't what it should be, such as after a price rise, which a bill that varies has anyway. */
const priceChange = computed(() => {
  const { amount_varies: varies, last_payment_amount: last, amount } = props.subscription
  return !varies && last !== null && toCents(last) !== toCents(amount) ? last : null
})
</script>

<template>
  <v-card
    class="subscription-card h-100"
    :class="{ 'subscription-card--paused': !subscription.active }"
    data-test="subscription-card"
  >
    <v-card-text class="pa-5 pa-md-6">
      <div class="d-flex align-start ga-4">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="48">
          <v-icon :icon="Repeat" size="23" />
        </v-avatar>
        <div class="flex-grow-1 min-width-0">
          <div class="d-flex align-center flex-wrap ga-2">
            <h2 class="text-title-medium font-weight-bold ma-0" data-test="subscription-title">
              {{ subscription.name }}
            </h2>
            <v-chip
              v-if="!subscription.active"
              color="secondary"
              size="x-small"
              variant="tonal"
              data-test="subscription-paused-chip"
            >
              Paused
            </v-chip>
          </div>
          <p class="text-body-small text-medium-emphasis mb-0 mt-1">{{ subscription.payee }}</p>
        </div>
        <v-menu v-if="!readonly" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="EllipsisVertical"
              variant="text"
              size="small"
              :aria-label="`Actions for ${subscription.name}`"
              data-test="subscription-actions"
            />
          </template>
          <v-list density="compact" nav min-width="200">
            <v-list-item
              :prepend-icon="subscription.active ? CirclePause : Repeat"
              :title="subscription.active ? 'Pause matching' : 'Resume matching'"
              data-test="subscription-toggle"
              @click="emit('toggle', subscription)"
            />
            <v-list-item
              :prepend-icon="Pencil"
              title="Edit"
              data-test="subscription-edit"
              @click="emit('edit', subscription)"
            />
            <v-list-item
              :prepend-icon="Trash2"
              title="Delete"
              base-color="error"
              data-test="subscription-delete"
              @click="emit('delete', subscription)"
            />
          </v-list>
        </v-menu>
      </div>

      <div class="d-flex align-end justify-space-between ga-3 mt-6">
        <div>
          <p class="text-body-small text-medium-emphasis mb-1">
            {{ frequencyTitle(subscription.frequency) }}
            <v-chip
              v-if="subscription.amount_varies"
              size="x-small"
              variant="tonal"
              class="ms-1"
              data-test="subscription-varies"
            >
              Amount varies
            </v-chip>
          </p>
          <p class="text-headline-small font-weight-bold ma-0" data-test="subscription-amount">
            <span v-if="subscription.amount_varies" aria-label="About">~</span>
            {{ household.money(expected, account?.currency) }}
          </p>
        </div>
        <div class="text-end">
          <p class="text-body-small text-medium-emphasis mb-1">
            {{ household.money(monthlyAmount, account?.currency) }} / month
          </p>
          <p
            class="text-label-large font-weight-medium ma-0 d-flex align-center justify-end ga-1"
            :class="{ 'text-error': overdue }"
            data-test="subscription-due"
          >
            <v-icon :icon="CalendarClock" size="16" />
            {{ dueText }}
          </p>
        </div>
      </div>

      <v-divider class="my-4" />
      <div class="d-flex flex-wrap align-center ga-2">
        <v-chip size="small" variant="tonal" :prepend-icon="Landmark">
          {{ account?.name ?? 'Account unavailable' }}
        </v-chip>
        <CategoryChip v-if="subscription.category_id" :category-id="subscription.category_id" />
        <v-chip size="small" variant="outlined" data-test="subscription-payment-count">
          {{ subscription.payment_count }}
          {{ subscription.payment_count === 1 ? 'payment tracked' : 'payments tracked' }}
        </v-chip>
      </div>
      <p
        v-if="lastPayment"
        class="text-body-small text-medium-emphasis mt-3 mb-0"
        data-test="subscription-last-payment"
      >
        {{ lastPayment }}
      </p>
      <v-alert
        v-if="priceChange"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-test="subscription-price-change"
      >
        The last payment was {{ household.money(priceChange, account?.currency) }}, not
        {{ household.money(subscription.amount, account?.currency) }}.
        <template v-if="!readonly" #append>
          <v-btn
            variant="text"
            size="small"
            data-test="subscription-update-amount"
            @click="emit('update-amount', subscription)"
          >
            Update amount
          </v-btn>
        </template>
      </v-alert>
      <div class="d-flex flex-wrap ga-2 mt-2">
        <v-btn
          :to="{ name: 'transactions', query: { subscription: subscription.id } }"
          variant="text"
          size="small"
          color="primary"
          class="px-1"
          data-test="subscription-view-payments"
        >
          View tracked payments
        </v-btn>
        <v-btn
          v-if="!readonly"
          variant="text"
          size="small"
          color="primary"
          :prepend-icon="Link2"
          class="px-1"
          data-test="subscription-link-payments"
          @click="emit('link', subscription)"
        >
          Link payments
        </v-btn>
      </div>
      <v-alert
        v-if="inAlertWindow"
        color="warning"
        variant="tonal"
        density="compact"
        class="mt-4"
        data-test="subscription-due-alert"
      >
        Payment due within your {{ alertDays }}-day reminder window.
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.subscription-card {
  transition:
    border-color 160ms ease,
    transform 160ms ease;
}

.subscription-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.42);
  transform: translateY(-2px);
}

.subscription-card--paused {
  opacity: 0.76;
}

.min-width-0 {
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .subscription-card {
    transition: none;
  }

  .subscription-card:hover {
    transform: none;
  }
}
</style>
