<script setup lang="ts">
import { CalendarClock, CirclePause, Landmark, Pencil, Repeat, Trash2 } from '@lucide/vue'
import { computed } from 'vue'

import type { Subscription } from '@/api/subscriptions'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { fromIsoDate } from '@/utils/dates'
import { formatMoney, formatShortDate } from '@/utils/format'
import { useHousehold } from '@/composables/useHousehold'
import { estimatedAmount } from '@/views/subscriptions/recurrence'

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
}>()

const accounts = useAccountsStore()
const categories = useCategoriesStore()
const household = useHousehold()
const account = computed(() => accounts.find(props.subscription.account_id))
const category = computed(() => categories.find(props.subscription.category_id))
const dueText = computed(() => {
  if (props.daysUntilDue < 0) return `Overdue by ${Math.abs(props.daysUntilDue)} days`
  if (props.daysUntilDue === 0) return 'Due today'
  if (props.daysUntilDue === 1) return 'Due tomorrow'
  return `Due ${formatShortDate(fromIsoDate(props.subscription.next_due_date), household.locale.value)}`
})
const inAlertWindow = computed(
  () => props.dueAlertsEnabled && props.daysUntilDue >= 0 && props.daysUntilDue <= props.alertDays,
)
const monthlyAmount = computed(() =>
  estimatedAmount(props.subscription.amount, props.subscription.frequency, 'month'),
)
const frequencyText: Record<Subscription['frequency'], string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  quarterly: 'Every three months',
  semiannual: 'Every six months',
  annual: 'Annually',
}
</script>

<template>
  <v-card
    class="subscription-card h-100"
    :class="{ 'subscription-card--paused': !subscription.active }"
    rounded="xl"
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
        <v-menu v-if="!readonly">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="Pencil"
              variant="text"
              size="small"
              aria-label="Subscription actions"
              data-test="subscription-actions"
            />
          </template>
          <v-list density="compact">
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
              class="text-error"
              data-test="subscription-delete"
              @click="emit('delete', subscription)"
            />
          </v-list>
        </v-menu>
      </div>

      <div class="d-flex align-end justify-space-between ga-3 mt-6">
        <div>
          <p class="text-body-small text-medium-emphasis mb-1">
            {{ frequencyText[subscription.frequency] }}
          </p>
          <p class="text-headline-small font-weight-bold ma-0" data-test="subscription-amount">
            {{ formatMoney(subscription.amount, account?.currency, household.locale.value) }}
          </p>
        </div>
        <div class="text-end">
          <p class="text-body-small text-medium-emphasis mb-1">
            {{ formatMoney(monthlyAmount, account?.currency, household.locale.value) }} / month
          </p>
          <p class="text-label-large font-weight-medium ma-0 d-flex align-center justify-end ga-1">
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
        <v-chip v-if="category" size="small" variant="tonal">
          {{ category.emoji }} {{ category.name }}
        </v-chip>
        <v-chip size="small" variant="outlined" data-test="subscription-payment-count">
          {{ subscription.payment_count }}
          {{ subscription.payment_count === 1 ? 'payment tracked' : 'payments tracked' }}
        </v-chip>
      </div>
      <v-btn
        :to="{ name: 'transactions', query: { subscription: subscription.id } }"
        variant="text"
        size="small"
        class="mt-3 px-0"
        data-test="subscription-view-payments"
      >
        View tracked payments
      </v-btn>
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
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
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
</style>
