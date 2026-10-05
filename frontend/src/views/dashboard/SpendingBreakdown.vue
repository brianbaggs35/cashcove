<script setup lang="ts">
import { ChartPie } from '@lucide/vue'
import { computed } from 'vue'
import { useDisplay } from 'vuetify'
import { VPie } from 'vuetify/labs/VPie'

import type { CategoryTotal } from '@/api/budget'
import ChartFrame from '@/components/ui/ChartFrame.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useCategoriesStore } from '@/stores/categories'
import { slices, type Slice } from '@/views/dashboard/summary'

/** Where this month's spending went, by category: a ring of Vuetify's pie, and every part of it written out beside it. */
const props = defineProps<{ categories: CategoryTotal[] }>()

const { money } = useHousehold()
const { xs } = useDisplay()
const categoryStore = useCategoriesStore()

function nameOf(slice: Slice): string {
  if (slice.rest) return 'Everything else'
  return categoryStore.find(slice.categoryId)?.name ?? 'Uncategorized'
}

const parts = computed(() => slices(props.categories))
const total = computed(() => parts.value.reduce((sum, slice) => sum + slice.cents, 0))
const rows = computed(() =>
  parts.value.map((slice) => ({
    key: slice.key,
    color: slice.color,
    cents: slice.cents,
    name: nameOf(slice),
    emoji: categoryStore.find(slice.categoryId)?.emoji ?? '',
    amount: money(slice.cents / 100),
    share: `${Math.round((slice.cents / total.value) * 100)}%`,
    count: slice.count,
  })),
)
const items = computed(() =>
  rows.value.map((row) => ({ key: row.key, title: row.name, value: row.cents, color: row.color })),
)
</script>

<template>
  <v-card class="h-100" data-test="spending-breakdown">
    <v-card-text class="pa-5">
      <ChartFrame
        title="Where it went"
        description="This month's spending, by category."
        :rows="rows.length"
      >
        <template #chart>
          <EmptyState
            v-if="!rows.length"
            compact
            :icon="ChartPie"
            title="No spending yet this month"
            text="Once money goes out, you'll see what it went to."
          />
          <div v-else class="spend" data-test="spending-chart">
            <div class="spend__ring" aria-hidden="true">
              <v-pie
                :items="items"
                :size="216"
                :inner-cut="68"
                :gap="2"
                :rounded="4"
                :hover-scale="0.03"
                hide-slice
              >
                <template #center>
                  <div class="text-center">
                    <div class="text-label-medium text-medium-emphasis">Spent</div>
                    <div class="text-title-large font-weight-bold" data-test="spending-total">
                      {{ money(total / 100) }}
                    </div>
                  </div>
                </template>
              </v-pie>
            </div>
            <ul class="spend__list pa-0 ma-0">
              <li
                v-for="row in rows"
                :key="row.key"
                class="d-flex align-center ga-2"
                data-test="spending-part"
              >
                <span class="spend__key" :style="{ background: row.color }" aria-hidden="true" />
                <span class="text-body-medium text-truncate flex-grow-1">
                  <span v-if="row.emoji" class="me-1" aria-hidden="true">{{ row.emoji }}</span>
                  {{ row.name }}
                </span>
                <span class="text-body-medium font-weight-medium tabular-nums">{{
                  row.amount
                }}</span>
                <span class="spend__share text-body-small text-medium-emphasis tabular-nums">
                  {{ row.share }}
                </span>
              </li>
            </ul>
          </div>
        </template>

        <template #table>
          <table data-test="spending-table">
            <caption>
              What was spent this month in each category
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Spent</th>
                <th scope="col">Share</th>
                <th v-if="!xs" scope="col">Transactions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.key" data-test="spending-row">
                <th scope="row">
                  {{ row.name }}
                  <!-- A phone has no room for every column, so the category carries the count. -->
                  <span v-if="xs" class="spend__more" data-test="spending-more">
                    {{ row.count }} {{ row.count === 1 ? 'transaction' : 'transactions' }}
                  </span>
                </th>
                <td>{{ row.amount }}</td>
                <td>{{ row.share }}</td>
                <td v-if="!xs">{{ row.count }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </ChartFrame>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.spend {
  display: grid;
  gap: 20px;
}

.spend__ring {
  display: grid;
  place-items: center;
  padding: 8px;
}

.spend__list {
  display: grid;
  gap: 10px;
  list-style: none;
}

.spend__key {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  flex-shrink: 0;
}

.spend__more {
  display: block;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--chart-muted);
}

.spend__share {
  min-width: 4ch;
  text-align: end;
}
</style>
