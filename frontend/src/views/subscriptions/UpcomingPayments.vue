<script setup lang="ts">
import { CalendarClock } from '@lucide/vue'
import { computed } from 'vue'

import type { UpcomingPayment } from '@/api/subscriptions'
import { useHousehold } from '@/composables/useHousehold'
import { fromIsoDate } from '@/utils/dates'
import { dueText } from '@/views/dashboard/summary'
import { daysUntil } from '@/views/subscriptions/recurrence'

/**
 * The payments that come next, counted on from the one that is due, with how long until each. A
 * bill that is a different amount every time is only expected to be about that much.
 */
const props = defineProps<{
  upcoming: UpcomingPayment[]
  /** The amount changes every time, so each is an estimate. */
  varies: boolean
  /** Not being tracked, so nothing is matched to these or reminded of. */
  paused: boolean
  currency?: string
}>()

const { money, locale } = useHousehold()

const rows = computed(() =>
  props.upcoming.map((payment, index) => {
    const days = daysUntil(payment.due_on)
    return {
      dueOn: payment.due_on,
      date: new Intl.DateTimeFormat(locale.value, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(fromIsoDate(payment.due_on)),
      when: dueText(days),
      late: days < 0,
      next: index === 0,
      amount: money(payment.amount, props.currency),
    }
  }),
)
</script>

<template>
  <v-card data-test="upcoming-payments">
    <v-card-text class="pa-5">
      <header class="d-flex align-center ga-2 mb-3">
        <v-icon :icon="CalendarClock" size="20" class="text-medium-emphasis" aria-hidden="true" />
        <h2 class="text-title-medium font-weight-bold ma-0">Coming up</h2>
      </header>
      <p
        v-if="paused"
        class="text-body-small text-medium-emphasis mt-0 mb-3"
        data-test="upcoming-paused"
      >
        Paused, so nothing is matched to these dates and no reminder is sent. They are where it left
        off.
      </p>
      <ol class="upcoming pa-0 ma-0">
        <li
          v-for="row in rows"
          :key="row.dueOn"
          class="upcoming__row d-flex align-center ga-3"
          :class="{ 'upcoming__row--next': row.next }"
          data-test="upcoming-payment"
        >
          <div class="flex-grow-1 min-width-0">
            <p class="text-body-medium font-weight-medium ma-0" data-test="upcoming-date">
              {{ row.date }}
              <v-chip v-if="row.next" size="x-small" variant="tonal" class="ms-1">Next</v-chip>
            </p>
            <p
              class="text-body-small ma-0"
              :class="row.late ? 'text-error' : 'text-medium-emphasis'"
              data-test="upcoming-when"
            >
              {{ row.when }}
            </p>
          </div>
          <span class="tabular-nums font-weight-medium text-no-wrap" data-test="upcoming-amount">
            <span v-if="varies" aria-label="About">~</span>
            {{ row.amount }}
          </span>
        </li>
      </ol>
      <p v-if="varies" class="text-body-small text-medium-emphasis mt-3 mb-0">
        The amount changes every time, so these are about what recent payments came to.
      </p>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.upcoming {
  display: grid;
  gap: 8px;
  list-style: none;
}

.upcoming__row {
  padding: 10px 14px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.upcoming__row--next {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.06);
}

.min-width-0 {
  min-width: 0;
}
</style>
