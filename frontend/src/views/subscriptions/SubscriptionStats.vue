<script setup lang="ts">
import { CalendarClock, CalendarDays, CalendarX, Coins, Wallet } from '@lucide/vue'
import { computed } from 'vue'

import type { PaymentSummary, Subscription } from '@/api/subscriptions'
import StatTile from '@/components/ui/StatTile.vue'
import { useHousehold } from '@/composables/useHousehold'
import { formatListDate, fromIsoDate } from '@/utils/dates'
import { formatCount, formatShortDate } from '@/utils/format'
import { dueText } from '@/views/dashboard/summary'
import {
  daysUntil,
  estimatedAmount,
  expectedAmount,
  expectsPayment,
  frequencyTitle,
  hasEnded,
  standing,
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
/** It talks of its next payment: it hasn't stopped, and doesn't end before then. Otherwise, of its end. */
const expecting = computed(() => expectsPayment(props.subscription))
/** One that has stopped has no next payment and costs nothing now: its figures say what they were. */
const stopped = computed(() => standing(props.subscription) === 'cancelled')
const late = computed(() => props.subscription.active && expecting.value && days.value < 0)
/** What the next-due tile shows: when it is due, or once nothing more is, when it ends. */
const next = computed(() => {
  const { next_due_date: due, ends_on: ends, cancelled_on: cancelled, active } = props.subscription
  if (expecting.value) {
    return {
      icon: CalendarClock,
      label: 'Next due',
      day: due,
      detail: active ? dueText(days.value) : 'Paused',
    }
  }
  const endNote = cancelled
    ? `Cancelled ${formatShortDate(fromIsoDate(cancelled), locale.value)}`
    : 'No more payments'
  return {
    icon: CalendarX,
    label: hasEnded(props.subscription) ? 'Ended' : 'Ends',
    day: ends as string,
    detail: endNote,
  }
})
const paidSince = computed(() => {
  const first = props.summary.first_on
  const count = formatCount(props.subscription.payment_count, 'payment', locale.value)
  return first ? `${count} since ${formatShortDate(fromIsoDate(first), locale.value)}` : count
})
</script>

<template>
  <v-row density="compact" data-test="subscription-stats">
    <v-col cols="6" md="3">
      <StatTile
        :icon="Coins"
        :label="stopped ? 'Each payment' : 'Next payment'"
        data-test="stat-expected"
      >
        <span v-if="subscription.amount_varies" aria-label="About">~</span>
        {{ money(expected, currency) }}
        <template #detail>
          {{ frequencyTitle(subscription.frequency)
          }}{{ subscription.amount_varies ? ' · changes every time' : '' }}
        </template>
      </StatTile>
    </v-col>
    <v-col cols="6" md="3">
      <StatTile :icon="next.icon" :label="next.label" data-test="stat-due">
        {{ formatListDate(next.day, locale) }}
        <template #detail>
          <span :class="{ 'text-error': late }">{{ next.detail }}</span>
        </template>
      </StatTile>
    </v-col>
    <v-col cols="6" md="3">
      <StatTile
        :icon="CalendarDays"
        :label="stopped ? 'Used to cost' : 'Costs about'"
        data-test="stat-cost"
      >
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
