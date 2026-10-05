<script setup lang="ts">
import {
  Banknote,
  CalendarClock,
  EllipsisVertical,
  History,
  Landmark,
  Pause,
  Pencil,
  PiggyBank,
  Play,
  Trash2,
  TriangleAlert,
  WandSparkles,
} from '@lucide/vue'
import { computed } from 'vue'

import type { Automation } from '@/api/automations'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useBudgetsStore } from '@/stores/budgets'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { amountPhrase, matchPhrases } from '@/views/automations/looks'
import { kinds } from '@/views/subscriptions/kinds'

/** One automation: who it sorts, where, and what it does with them. Admins can change it. */
const props = withDefaults(defineProps<{ automation: Automation; readonly?: boolean }>(), {
  readonly: false,
})
const emit = defineEmits<{
  edit: [automation: Automation]
  delete: [automation: Automation]
  toggle: [automation: Automation]
}>()

const SHOWN_PAYEES = 3

const accounts = useAccountsStore()
const subscriptions = useSubscriptionsStore()
const budgets = useBudgetsStore()
const { money } = useHousehold()

const amounts = computed(() =>
  amountPhrase({ min: props.automation.min_amount, max: props.automation.max_amount }, money),
)
const shownPayees = computed(() => props.automation.payees.slice(0, SHOWN_PAYEES))
const morePayees = computed(() => props.automation.payees.length - SHOWN_PAYEES)
const accountName = computed(() => {
  if (props.automation.account_id === null) return 'Any account'
  return accounts.find(props.automation.account_id)?.name ?? 'Account unavailable'
})
const subscription = computed(() => subscriptions.find(props.automation.subscription_id))
/** The subscription or bill it links payments to: which it is, and its name. */
const subscriptionKind = computed(() => kinds[subscription.value?.kind ?? 'subscription'])
const subscriptionLabel = computed(() => {
  if (!subscription.value) return 'Subscription or bill'
  return subscription.value.active ? subscription.value.name : `${subscription.value.name} (paused)`
})
/** The budgets it counts what it sorts toward. */
const counted = computed(() =>
  props.automation.counts.map((count) => ({
    ...count,
    name: budgets.find(count.budget_id)?.name ?? 'a budget',
  })),
)
/** What it gave was deleted, so there's nothing left for it to do. */
const idle = computed(
  () =>
    props.automation.category_id === null &&
    props.automation.subscription_id === null &&
    props.automation.counts.length === 0,
)
const matches = computed(() => {
  const count = props.automation.matching_count
  return count === 1 ? '1 matching transaction' : `${count.toLocaleString()} matching transactions`
})
</script>

<template>
  <v-card
    class="automation-card h-100"
    :class="{ 'automation-card--paused': !automation.active }"
    data-test="automation-card"
  >
    <v-card-text class="pa-5 pa-md-6">
      <div class="d-flex align-start ga-4">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="48">
          <v-icon :icon="WandSparkles" size="23" />
        </v-avatar>
        <div class="flex-grow-1 min-width-0">
          <div class="d-flex align-center flex-wrap ga-2">
            <h2 class="text-title-medium font-weight-bold ma-0" data-test="automation-title">
              {{ automation.name }}
            </h2>
            <v-chip
              v-if="!automation.active"
              color="secondary"
              size="x-small"
              variant="tonal"
              data-test="automation-paused-chip"
            >
              Paused
            </v-chip>
          </div>
          <p class="text-body-small text-medium-emphasis mb-0 mt-1" data-test="automation-matches">
            {{ matches }}
          </p>
        </div>
        <v-menu v-if="!readonly" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="EllipsisVertical"
              variant="text"
              size="small"
              :aria-label="`Actions for ${automation.name}`"
              data-test="automation-actions"
            />
          </template>
          <v-list density="compact" nav min-width="200">
            <v-list-item
              :prepend-icon="automation.active ? Pause : Play"
              :title="automation.active ? 'Pause' : 'Resume'"
              data-test="automation-toggle"
              @click="emit('toggle', automation)"
            />
            <v-list-item
              :prepend-icon="Pencil"
              title="Edit"
              data-test="automation-edit"
              @click="emit('edit', automation)"
            />
            <v-list-item
              :prepend-icon="Trash2"
              title="Delete"
              base-color="error"
              data-test="automation-delete"
              @click="emit('delete', automation)"
            />
          </v-list>
        </v-menu>
      </div>

      <v-divider class="my-4" />

      <dl class="automation-card__rules">
        <dt data-test="automation-looks">{{ matchPhrases[automation.match] }}</dt>
        <dd class="d-flex flex-wrap ga-1" data-test="automation-payees">
          <v-chip v-for="payee in shownPayees" :key="payee" size="small" variant="tonal">
            {{ payee }}
          </v-chip>
          <v-chip v-if="morePayees > 0" size="small" variant="outlined">
            +{{ morePayees }} more
          </v-chip>
        </dd>
        <dt>In</dt>
        <dd data-test="automation-account">
          <v-chip size="small" variant="tonal" :prepend-icon="Landmark">{{ accountName }}</v-chip>
        </dd>
        <template v-if="amounts">
          <dt>For</dt>
          <dd data-test="automation-amounts">
            <v-chip size="small" variant="tonal" :prepend-icon="Banknote">{{ amounts }}</v-chip>
          </dd>
        </template>
        <dt>Then</dt>
        <dd class="d-flex flex-wrap ga-1">
          <CategoryChip v-if="automation.category_id" :category-id="automation.category_id" />
          <v-chip
            v-if="automation.subscription_id"
            size="small"
            variant="tonal"
            :prepend-icon="subscriptionKind.icon"
            data-test="automation-subscription"
          >
            {{ subscriptionLabel }}
          </v-chip>
          <v-chip
            v-for="count in counted"
            :key="count.budget_id"
            size="small"
            variant="tonal"
            :prepend-icon="PiggyBank"
            data-test="automation-budget"
          >
            {{ count.kind === 'income' ? 'Income' : 'Spending' }} in {{ count.name }}
          </v-chip>
          <span v-if="idle" class="text-body-small text-medium-emphasis">Nothing yet</span>
        </dd>
      </dl>

      <div class="d-flex flex-wrap align-center ga-2 mt-4">
        <v-chip
          size="small"
          variant="outlined"
          :prepend-icon="automation.apply_to === 'all' ? History : CalendarClock"
          data-test="automation-scope"
        >
          {{ automation.apply_to === 'all' ? 'Past and future' : 'Future only' }}
        </v-chip>
      </div>

      <v-alert
        v-if="idle"
        color="warning"
        variant="tonal"
        density="compact"
        :icon="TriangleAlert"
        class="mt-4"
        data-test="automation-idle"
      >
        The category, subscription or bill it gave was deleted. Edit it to choose what it does now.
      </v-alert>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.automation-card {
  transition:
    border-color 160ms ease,
    transform 160ms ease;
}

.automation-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.42);
  transform: translateY(-2px);
}

.automation-card--paused {
  opacity: 0.76;
}

.automation-card__rules {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 10px 16px;
  margin: 0;
}

.automation-card__rules dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.automation-card__rules dd {
  margin: 0;
  min-width: 0;
}

.min-width-0 {
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .automation-card {
    transition: none;
  }

  .automation-card:hover {
    transform: none;
  }
}
</style>
