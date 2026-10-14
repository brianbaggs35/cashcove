<script setup lang="ts">
import { CalendarClock, CalendarDays, Coins, Wallet } from '@lucide/vue'
import { computed } from 'vue'

import type { PaymentSummary, Subscription } from '@/api/subscriptions'
import StatTile from '@/components/ui/StatTile.vue'
import { useHousehold } from '@/composables/useHousehold'
import { formatListDate } from '@/utils/dates'
import { fromIsoDate } from '@/utils/dates'
import { formatCount, formatShortDate } from '@/utils/format'
import { dueText } from '@/views/dashboard/summary'
import {
  daysUntil,
  estimatedAmount,
  expectedAmount,
  frequencyTitle,
} from '@/views/subscriptions/recurrence'

/** What a subscription or a bill costs and when it falls due: four figures at the top of its page. */
const props = defineProps<{
  subscription: Subscription
  summary: PaymentSummary
  currency?: string
}>()

const { money, locale } = useHousehold()
const expected = computed(() => expectedAmount(props.subscription))
const monthly = computed(() =>
  estimatedAmount(expected.value, props.subscription.frequency, 'month'),
)
const yearly = computed(() => estimatedAmount(expected.value, props.subscription.frequency, 'year'))
const days = computed(() => daysUntil(props.subscription.next_due_date))
const late = computed(() => props.subscription.active && days.value < 0)
const paidSince = computed(() => {
  const first = props.summary.first_on
  const count = formatCount(props.subscription.payment_count, 'payment', locale.value)
  return first ? `${count} since ${formatShortDate(fromIsoDate(first), locale.value)}` : count
})
</script>

<template>
  <v-row density="compact" data-test="subscription-stats">
    <v-col cols="6" md="3">
      <StatTile :icon="Coins" label="Next payment" data-test="stat-expected">
        <span v-if="subscription.amount_varies" aria-label="About">~</span>
        {{ money(expected, currency) }}
        <template #detail>
          {{ frequencyTitle(subscription.frequency)
          }}{{ subscription.amount_varies ? ' · changes every time' : '' }}
        </template>
      </StatTile>
    </v-col>
    <v-col cols="6" md="3">
      <StatTile :icon="CalendarClock" label="Next due" data-test="stat-due">
        {{ formatListDate(subscription.next_due_date, locale) }}
        <template #detail>
          <span :class="{ 'text-error': late }">{{
            subscription.active ? dueText(days) : 'Paused'
          }}</span>
        </template>
      </StatTile>
    </v-col>
    <v-col cols="6" md="3">
      <StatTile :icon="CalendarDays" label="Costs about" data-test="stat-cost">
        {{ money(monthly, currency) }}
        <template #detail>a month · {{ money(yearly, currency) }} a year</template>
      </StatTile>
    </v-col>
    <v-col cols="6" md="3">
      <StatTile :icon="Wallet" label="Paid so far" data-test="stat-paid">
        {{ money(summary.total, currency) }}
        <template #detail>{{ paidSince }}</template>
      </StatTile>
    </v-col>
  </v-row>
</template>
