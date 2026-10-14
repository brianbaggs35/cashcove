<script setup lang="ts">
import { Info } from '@lucide/vue'
import { computed } from 'vue'

import type { Account } from '@/api/accounts'
import type { Subscription } from '@/api/subscriptions'
import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import { useHousehold } from '@/composables/useHousehold'
import { formatCount, formatDateTime } from '@/utils/format'
import { kinds } from '@/views/subscriptions/kinds'
import { frequencyTitle } from '@/views/subscriptions/recurrence'

/** Everything that was set up about a subscription or a bill, and when it was. */
const props = defineProps<{
  subscription: Subscription
  account?: Account
  /** Whether to warn before it is due, and how many days ahead, as Settings has it. */
  reminder: { enabled: boolean; days: number }
}>()

const { money, locale } = useHousehold()
const copy = computed(() => kinds[props.subscription.kind])
const currency = computed(() => props.account?.currency)
const amount = computed(() => money(props.subscription.amount, currency.value))
const typical = computed(() =>
  props.subscription.typical_amount === null
    ? null
    : money(props.subscription.typical_amount, currency.value),
)
const reminderText = computed(() => {
  const { enabled, days } = props.reminder
  if (!enabled) return 'Off'
  return days === 0 ? 'On the day it is due' : `${formatCount(days, 'day')} before it is due`
})
const when = (value: string) => formatDateTime(value, locale.value)
</script>

<template>
  <v-card data-test="subscription-details">
    <v-card-text class="pa-5">
      <header class="d-flex align-center ga-2 mb-3">
        <v-icon :icon="Info" size="20" class="text-medium-emphasis" aria-hidden="true" />
        <h2 class="text-title-medium font-weight-bold ma-0">Details</h2>
      </header>
      <dl class="details">
        <div class="details__row">
          <dt>Type</dt>
          <dd data-test="detail-kind">
            <span class="d-inline-flex align-center ga-2">
              <v-icon :icon="copy.icon" size="16" aria-hidden="true" />{{ copy.title }}
            </span>
          </dd>
        </div>
        <div class="details__row">
          <dt>{{ subscription.amount_varies ? 'Estimated amount' : 'Payment amount' }}</dt>
          <dd data-test="detail-amount">
            {{ amount }}
            <span v-if="subscription.amount_varies" class="d-block text-medium-emphasis">
              Different every time<template v-if="typical">
                · recent payments average {{ typical }}</template
              >
            </span>
          </dd>
        </div>
        <div class="details__row">
          <dt>Repeats</dt>
          <dd data-test="detail-frequency">{{ frequencyTitle(subscription.frequency) }}</dd>
        </div>
        <div class="details__row">
          <dt>Paid from</dt>
          <dd data-test="detail-account">
            <span v-if="account" class="d-flex align-center ga-3">
              <AccountAvatar :type="account.type" :size="32" />
              <span class="min-width-0">
                {{ account.name }}
                <span v-if="account.institution" class="d-block text-medium-emphasis">
                  {{ account.institution }}
                </span>
              </span>
            </span>
            <template v-else>Account unavailable</template>
          </dd>
        </div>
        <div class="details__row">
          <dt>Category</dt>
          <dd><CategoryChip :category-id="subscription.category_id" /></dd>
        </div>
        <div class="details__row">
          <dt>Matches payee</dt>
          <dd data-test="detail-payee">
            {{ subscription.payee }}
            <span class="d-block text-medium-emphasis">
              {{
                subscription.active
                  ? 'Payments to it from that account are linked automatically.'
                  : 'Paused, so new payments are not linked.'
              }}
            </span>
          </dd>
        </div>
        <div class="details__row">
          <dt>Reminder</dt>
          <dd data-test="detail-reminder">
            {{ reminderText }}
            <router-link to="/settings/alerts" class="d-block">Alert settings</router-link>
          </dd>
        </div>
        <div v-if="subscription.notes" class="details__row">
          <dt>Notes</dt>
          <dd class="details__notes" data-test="detail-notes">{{ subscription.notes }}</dd>
        </div>
        <div class="details__row">
          <dt>Added</dt>
          <dd data-test="detail-created">{{ when(subscription.created_at) }}</dd>
        </div>
        <div class="details__row">
          <dt>Last changed</dt>
          <dd data-test="detail-updated">{{ when(subscription.updated_at) }}</dd>
        </div>
      </dl>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.details {
  margin: 0;
}

.details__row {
  display: grid;
  grid-template-columns: minmax(96px, 0.8fr) minmax(0, 1.4fr);
  align-items: start;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.details__row:first-child {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.details__row dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.details__row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.details__notes {
  white-space: pre-line;
}

.min-width-0 {
  min-width: 0;
}
</style>
