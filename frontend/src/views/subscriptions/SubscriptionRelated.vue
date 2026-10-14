<script setup lang="ts">
import { PiggyBank, WandSparkles } from '@lucide/vue'

import type { LinkedAutomation, LinkedBudget } from '@/api/subscriptions'
import { periodTitles } from '@/views/budget/periods'
import { kinds } from '@/views/subscriptions/kinds'
import type { RecurringKind } from '@/api/subscriptions'

/** The automations that link payments to a subscription or a bill, and the budgets that count them. */
defineProps<{
  kind: RecurringKind
  automations: LinkedAutomation[]
  budgets: LinkedBudget[]
}>()
</script>

<template>
  <v-card data-test="subscription-related">
    <v-card-text class="pa-5">
      <section aria-labelledby="related-automations">
        <header class="d-flex align-center ga-2 mb-3">
          <v-icon :icon="WandSparkles" size="20" class="text-medium-emphasis" aria-hidden="true" />
          <h2 id="related-automations" class="text-title-medium font-weight-bold ma-0">
            Automations
          </h2>
        </header>
        <ul v-if="automations.length" class="related pa-0 ma-0" data-test="related-automations">
          <li v-for="automation in automations" :key="automation.id">
            <router-link to="/automations" class="related__link d-flex align-center ga-2">
              <span class="flex-grow-1 text-truncate">{{ automation.name }}</span>
              <v-chip v-if="!automation.active" size="x-small" variant="tonal" color="secondary">
                Paused
              </v-chip>
            </router-link>
          </li>
        </ul>
        <p
          v-else
          class="text-body-small text-medium-emphasis ma-0"
          data-test="related-no-automations"
        >
          No automation links payments to this {{ kinds[kind].noun }}. An automation can also catch
          other spellings of the payee.
        </p>
      </section>

      <v-divider class="my-4" />

      <section aria-labelledby="related-budgets">
        <header class="d-flex align-center ga-2 mb-3">
          <v-icon :icon="PiggyBank" size="20" class="text-medium-emphasis" aria-hidden="true" />
          <h2 id="related-budgets" class="text-title-medium font-weight-bold ma-0">Budgets</h2>
        </header>
        <ul v-if="budgets.length" class="related pa-0 ma-0" data-test="related-budgets">
          <li v-for="budget in budgets" :key="budget.id">
            <router-link
              :to="{ name: 'budget', query: { budget: budget.id } }"
              class="related__link d-flex align-center ga-2"
            >
              <span class="flex-grow-1 text-truncate">{{ budget.name }}</span>
              <v-chip size="x-small" variant="outlined">{{ periodTitles[budget.period] }}</v-chip>
            </router-link>
          </li>
        </ul>
        <p v-else class="text-body-small text-medium-emphasis ma-0" data-test="related-no-budgets">
          No budget counts its payments as spending yet.
        </p>
      </section>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.related {
  display: grid;
  gap: 8px;
  list-style: none;
}

.related__link {
  padding: 10px 14px;
  color: inherit;
  text-decoration: none;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.related__link:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.related__link:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
