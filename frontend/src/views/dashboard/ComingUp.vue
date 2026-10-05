<script setup lang="ts">
import { CalendarClock, CircleCheck } from '@lucide/vue'
import { computed } from 'vue'

import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import DashboardCard from '@/views/dashboard/DashboardCard.vue'
import { LOOK_AHEAD, dueText, type DueItem } from '@/views/dashboard/summary'
import { kinds } from '@/views/subscriptions/kinds'

/** The bills and subscriptions that are overdue or due in the next couple of weeks, the soonest first. */
const props = defineProps<{ items: DueItem[] }>()

/** How many are listed before the rest are left to their own tabs. */
const SHOWN = 5

const { money, locale } = useHousehold()

const rows = computed(() =>
  props.items.slice(0, SHOWN).map((item) => ({
    ...item,
    when: dueText(item.days),
    date: formatShortDate(fromIsoDate(item.dueOn), locale.value),
    late: item.days < 0,
    icon: kinds[item.kind].icon,
    to: `/${kinds[item.kind].tab}`,
  })),
)
const more = computed(() => props.items.length - SHOWN)
</script>

<template>
  <DashboardCard title="Coming up" :icon="CalendarClock" data-test="coming-up">
    <EmptyState
      v-if="!items.length"
      compact
      :icon="CircleCheck"
      title="Nothing due soon"
      :text="`No bill or subscription is due in the next ${LOOK_AHEAD} days.`"
    />
    <ul v-else class="coming pa-0 ma-0">
      <li v-for="row in rows" :key="row.id" data-test="coming-up-item">
        <router-link :to="row.to" class="coming__link d-flex align-center ga-3">
          <v-icon
            :icon="row.icon"
            size="18"
            :class="row.late ? 'text-error' : 'text-medium-emphasis'"
            aria-hidden="true"
          />
          <span class="flex-grow-1 min-width-0">
            <span class="d-block text-body-medium font-weight-medium text-truncate">
              {{ row.name }}
            </span>
            <span
              class="d-block text-body-small"
              :class="row.late ? 'text-error' : 'text-medium-emphasis'"
              data-test="coming-up-when"
            >
              {{ row.when }} · {{ row.date }}
            </span>
          </span>
          <span class="tabular-nums font-weight-medium">{{ money(row.amount) }}</span>
        </router-link>
      </li>
    </ul>
    <p
      v-if="more > 0"
      class="text-body-small text-medium-emphasis mt-3 mb-0"
      data-test="coming-up-more"
    >
      And {{ more }} more soon.
    </p>
  </DashboardCard>
</template>

<style scoped>
.coming {
  display: grid;
  gap: 8px;
  list-style: none;
}

.coming__link {
  padding: 10px 14px;
  color: inherit;
  text-decoration: none;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.coming__link:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.coming__link:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.min-width-0 {
  min-width: 0;
}
</style>
