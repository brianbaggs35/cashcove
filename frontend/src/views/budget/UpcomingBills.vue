<script setup lang="ts">
import { CalendarClock } from '@lucide/vue'
import { computed } from 'vue'

import type { UpcomingBill } from '@/api/budget'
import { useHousehold } from '@/composables/useHousehold'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import { sumAmounts, toCents } from '@/utils/money'

/** The subscription payments this budget counts that are still to come before the period ends, and what would be left after them. */
const props = defineProps<{ bills: UpcomingBill[]; left: string }>()

const { money, locale } = useHousehold()
const total = computed(() => sumAmounts(props.bills.map((bill) => bill.amount)))
const after = computed(() => toCents(props.left) - toCents(total.value))
</script>

<template>
  <v-card data-test="upcoming-bills">
    <v-card-text class="pa-5">
      <div class="d-flex flex-wrap align-center gc-6 gr-1">
        <h3 class="text-title-medium font-weight-bold d-flex align-center ga-2 ma-0 flex-grow-1">
          <v-icon :icon="CalendarClock" size="20" />
          Bills still to come
        </h3>
        <p class="text-body-medium ma-0">
          <span class="text-medium-emphasis">Left to spend after them </span>
          <strong
            class="tabular-nums"
            :class="{ 'text-error': after < 0 }"
            data-test="upcoming-after"
          >
            {{ money(after / 100) }}
          </strong>
        </p>
      </div>
      <ul class="upcoming__list pa-0 mt-3 mb-0">
        <li
          v-for="bill in bills"
          :key="`${bill.subscription_id}-${bill.due_on}`"
          class="upcoming__bill d-flex align-center ga-3"
          data-test="upcoming-bill"
        >
          <div class="flex-grow-1 min-width-0">
            <p class="text-body-medium font-weight-medium text-truncate ma-0">{{ bill.name }}</p>
            <p class="text-body-small text-medium-emphasis ma-0">
              Due {{ formatShortDate(fromIsoDate(bill.due_on), locale) }}
            </p>
          </div>
          <span class="tabular-nums font-weight-medium">{{ money(bill.amount) }}</span>
        </li>
      </ul>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.upcoming__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 8px 16px;
  list-style: none;
}

.upcoming__bill {
  padding: 10px 14px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.min-width-0 {
  min-width: 0;
}
</style>
