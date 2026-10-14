<script setup lang="ts">
import {
  CalendarClock,
  CirclePause,
  EllipsisVertical,
  Eye,
  Landmark,
  Link2,
  Pencil,
  Trash2,
} from '@lucide/vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import type { Subscription } from '@/api/subscriptions'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import { kinds, partOf } from '@/views/subscriptions/kinds'
import {
  estimatedAmount,
  expectedAmount,
  frequencyTitle,
  priceChange,
} from '@/views/subscriptions/recurrence'

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
/** A subscription or a bill, which is the same card with a different icon and name. */
const copy = computed(() => kinds[props.subscription.kind])
const part = (name: string) => partOf(props.subscription.kind, name)
const account = computed(() => accounts.find(props.subscription.account_id))
/** Its own page, which the card opens from its name, the whole card and the menu. */
const page = computed(() => ({
  name: props.subscription.kind,
  params: { id: props.subscription.id },
}))
const router = useRouter()
/** What the menu's View does. It isn't a link, since a menu of actions only holds actions. */
function open() {
  void router.push(page.value)
}
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
/** A payment that isn't what it should be, such as after a price rise. */
const changedPrice = computed(() => priceChange(props.subscription))
</script>

<template>
  <v-card
    class="subscription-card h-100"
    :class="{ 'subscription-card--paused': !subscription.active }"
    :data-test="part('card')"
  >
    <v-card-text class="pa-5 pa-md-6">
      <div class="d-flex align-start ga-4">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="48">
          <v-icon :icon="copy.icon" size="23" />
        </v-avatar>
        <div class="flex-grow-1 min-width-0">
          <div class="d-flex align-center flex-wrap ga-2">
            <h2 class="text-title-medium font-weight-bold ma-0" :data-test="part('title')">
              <router-link :to="page" class="subscription-card__link" :data-test="part('open')">
                {{ subscription.name }}
              </router-link>
            </h2>
            <v-chip
              v-if="!subscription.active"
              color="secondary"
              size="x-small"
              variant="tonal"
              :data-test="part('paused-chip')"
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
              :data-test="part('actions')"
            />
          </template>
          <v-list density="compact" nav min-width="200">
            <v-list-item :prepend-icon="Eye" title="View" :data-test="part('view')" @click="open" />
            <v-list-item
              :prepend-icon="subscription.active ? CirclePause : copy.icon"
              :title="subscription.active ? 'Pause matching' : 'Resume matching'"
              :data-test="part('toggle')"
              @click="emit('toggle', subscription)"
            />
            <v-list-item
              :prepend-icon="Pencil"
              title="Edit"
              :data-test="part('edit')"
              @click="emit('edit', subscription)"
            />
            <v-list-item
              :prepend-icon="Trash2"
              title="Delete"
              base-color="error"
              :data-test="part('delete')"
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
              :data-test="part('varies')"
            >
              Amount varies
            </v-chip>
          </p>
          <p class="text-headline-small font-weight-bold ma-0" :data-test="part('amount')">
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
            :data-test="part('due')"
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
        <CategoryChip :category-id="subscription.category_id" />
        <v-chip size="small" variant="outlined" :data-test="part('payment-count')">
          {{ subscription.payment_count }}
          {{ subscription.payment_count === 1 ? 'payment tracked' : 'payments tracked' }}
        </v-chip>
      </div>
      <p
        v-if="lastPayment"
        class="text-body-small text-medium-emphasis mt-3 mb-0"
        :data-test="part('last-payment')"
      >
        {{ lastPayment }}
      </p>
      <v-alert
        v-if="changedPrice"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-3"
        :data-test="part('price-change')"
      >
        The last payment was {{ household.money(changedPrice, account?.currency) }}, not
        {{ household.money(subscription.amount, account?.currency) }}.
        <template v-if="!readonly" #append>
          <v-btn
            variant="text"
            size="small"
            :data-test="part('update-amount')"
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
          :data-test="part('view-payments')"
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
          :data-test="part('link-payments')"
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
        :data-test="part('due-alert')"
      >
        Payment due within your {{ alertDays }}-day reminder window.
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.subscription-card {
  cursor: pointer;
  transition:
    border-color 160ms ease,
    transform 160ms ease;
}

/* The name is the card's one link, and reaches across the whole card, so anywhere on it opens the
   page without a link inside a link. What can be pressed on its own sits above that. */
.subscription-card__link {
  color: inherit;
  text-decoration: none;
}

.subscription-card__link::after {
  content: '';
  position: absolute;
  inset: 0;
  /* Over what only sits there, such as the chips, so pressing them opens the page too. */
  z-index: 1;
}

.subscription-card__link:focus-visible {
  outline: none;
}

.subscription-card__link:focus-visible::after {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
  border-radius: inherit;
}

.subscription-card :deep(.v-btn) {
  position: relative;
  z-index: 2;
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
