<script setup lang="ts">
import { Landmark, Plus, Repeat, Tags, WandSparkles, X, type LucideIcon } from '@lucide/vue'
import { computed } from 'vue'

import type { BudgetKind, BudgetSource, SourceType } from '@/api/budget'
import { useHousehold } from '@/composables/useHousehold'
import { useCategoriesStore } from '@/stores/categories'

/**
 * What counts toward the budget besides single transactions, as income and as spending: whole
 * accounts and categories, subscriptions and automations, with what each counted in the period.
 */
const props = defineProps<{
  sources: BudgetSource[]
  /** What the period's income and spending came to, in all. */
  income: string
  spent: string
  readonly: boolean
}>()
const emit = defineEmits<{ add: [kind: BudgetKind]; remove: [source: BudgetSource] }>()

const { money } = useHousehold()
const categories = useCategoriesStore()

const icons: Record<SourceType, LucideIcon> = {
  account: Landmark,
  category: Tags,
  subscription: Repeat,
  automation: WandSparkles,
}
const typeNames: Record<SourceType, string> = {
  account: 'Account',
  category: 'Category',
  subscription: 'Subscription',
  automation: 'Rule',
}

const columns = computed(() => [
  {
    kind: 'income' as const,
    title: 'Income',
    total: props.income,
    empty: 'Nothing counts as income yet. Add your paycheck, or the account it goes into.',
    sources: props.sources.filter((source) => source.kind === 'income'),
  },
  {
    kind: 'spending' as const,
    title: 'Spending',
    total: props.spent,
    empty:
      'Nothing counts as spending yet. Add the bills, subscriptions, accounts or categories you spend on.',
    sources: props.sources.filter((source) => source.kind === 'spending'),
  },
])

function detail(source: BudgetSource): string {
  const count = source.count === 1 ? '1 transaction' : `${source.count} transactions`
  return `${typeNames[source.type]} · ${money(source.amount)} from ${count}`
}
</script>

<template>
  <v-row density="compact" data-test="budget-sources">
    <v-col v-for="column in columns" :key="column.kind" cols="12" md="6">
      <v-card class="h-100" :data-test="`sources-${column.kind}`">
        <v-card-text class="pa-5">
          <div class="d-flex align-center ga-3">
            <div class="flex-grow-1">
              <h3 class="text-title-medium font-weight-bold ma-0">{{ column.title }}</h3>
              <p class="text-body-small text-medium-emphasis ma-0 tabular-nums">
                {{ money(column.total) }} this period
              </p>
            </div>
            <v-btn
              v-if="!readonly"
              variant="tonal"
              color="primary"
              size="small"
              :prepend-icon="Plus"
              :data-test="`add-${column.kind}`"
              @click="emit('add', column.kind)"
            >
              Add
            </v-btn>
          </div>
          <ul v-if="column.sources.length" class="sources__list pa-0 mt-3 mb-0">
            <li
              v-for="source in column.sources"
              :key="source.id"
              class="d-flex align-center ga-3 py-2"
              data-test="budget-source"
            >
              <v-avatar color="primary" variant="tonal" rounded="lg" size="36">
                <span
                  v-if="source.type === 'category' && categories.find(source.target_id)"
                  aria-hidden="true"
                >
                  {{ categories.find(source.target_id)?.emoji }}
                </span>
                <v-icon v-else :icon="icons[source.type]" size="18" />
              </v-avatar>
              <div class="flex-grow-1 sources__text">
                <p class="text-body-medium font-weight-medium text-truncate ma-0">
                  {{ source.name }}
                  <v-chip
                    v-if="!source.active"
                    size="x-small"
                    color="secondary"
                    variant="tonal"
                    class="ms-1"
                    data-test="source-paused"
                  >
                    Paused
                  </v-chip>
                </p>
                <p class="text-body-small text-medium-emphasis text-truncate ma-0">
                  {{ detail(source) }}
                </p>
              </div>
              <v-btn
                v-if="!readonly"
                :icon="X"
                variant="text"
                size="small"
                :aria-label="`Stop counting ${source.name}`"
                data-test="source-remove"
                @click="emit('remove', source)"
              />
            </li>
          </ul>
          <p
            v-else
            class="text-body-medium text-medium-emphasis mt-3 mb-0"
            data-test="sources-empty"
          >
            {{ column.empty }}
          </p>
        </v-card-text>
      </v-card>
    </v-col>
  </v-row>
</template>

<style scoped>
.sources__list {
  list-style: none;
}

.sources__text {
  min-width: 0;
}
</style>
