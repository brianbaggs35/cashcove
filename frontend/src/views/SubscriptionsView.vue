<script setup lang="ts">
import { CalendarClock, Plus, Repeat, Search } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import {
  deleteSubscription,
  fetchSubscriptions,
  updateSubscription,
  type Subscription,
} from '@/api/subscriptions'
import { errorMessage } from '@/api/client'
import TabPage from '@/components/TabPage.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { todayIso } from '@/utils/dates'
import { formatMoney } from '@/utils/format'
import { toCents, fromCents } from '@/utils/money'
import SubscriptionCard from '@/views/subscriptions/SubscriptionCard.vue'
import SubscriptionDialog from '@/views/subscriptions/SubscriptionDialog.vue'
import { estimatedAmount } from '@/views/subscriptions/recurrence'

const auth = useAuthStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const preferences = usePreferencesStore()
const subscriptions = ref<Subscription[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const activeFilter = ref<'active' | 'paused'>('active')
const dialog = ref(false)
const editing = ref<Subscription | null>(null)
let request = 0

async function load() {
  const current = ++request
  loading.value = true
  error.value = null
  try {
    const result = await fetchSubscriptions()
    if (current === request) {
      subscriptions.value = result
      loaded.value = true
    }
  } catch (loadError) {
    if (current === request) error.value = errorMessage(loadError)
  } finally {
    if (current === request) loading.value = false
  }
}

onMounted(() => {
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  if (!preferences.saved) void preferences.load()
  void load()
})

const visibleSubscriptions = computed(() =>
  subscriptions.value.filter((subscription) => {
    const matchesState = subscription.active === (activeFilter.value === 'active')
    const query = search.value.trim().toLocaleLowerCase()
    return (
      matchesState &&
      (!query ||
        subscription.name.toLocaleLowerCase().includes(query) ||
        subscription.payee.toLocaleLowerCase().includes(query))
    )
  }),
)
const activeSubscriptions = computed(() => subscriptions.value.filter((item) => item.active))
const monthTotals = computed(() => sumByCurrency(activeSubscriptions.value, 'month'))
const yearTotals = computed(() => sumByCurrency(activeSubscriptions.value, 'year'))

function sumByCurrency(items: Subscription[], period: 'month' | 'year') {
  const totals = new Map<string, number>()
  for (const item of items) {
    const currency = accounts.find(item.account_id)?.currency ?? 'USD'
    const amount = estimatedAmount(item.amount, item.frequency, period)
    totals.set(currency, (totals.get(currency) ?? 0) + toCents(amount))
  }
  return [...totals].map(([currency, cents]) => ({ currency, amount: fromCents(cents) }))
}

function daysUntil(date: string) {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000,
  )
}

const alerts = computed(() => preferences.saved?.alerts)
const alertDays = computed(() => alerts.value?.subscription_due_days_before ?? 3)
const dueSoon = computed(
  () =>
    alerts.value?.subscription_due_enabled === true &&
    activeSubscriptions.value.filter((item) => {
      const days = daysUntil(item.next_due_date)
      return days >= 0 && days <= alertDays.value
    }).length,
)
const noSubscriptions = computed(() => loaded.value && subscriptions.value.length === 0)

function add() {
  editing.value = null
  dialog.value = true
}

function edit(subscription: Subscription) {
  editing.value = subscription
  dialog.value = true
}

async function remove(subscription: Subscription) {
  const done = await confirmAndRun(
    {
      title: `Delete ${subscription.name}?`,
      text: 'Its tracked transactions will stay in your history, but will no longer be linked.',
      confirmText: 'Delete subscription',
      tone: 'error',
    },
    () => deleteSubscription(subscription.id),
  )
  if (!done) return
  notify(`Deleted ${subscription.name}`)
  await load()
}

async function toggle(subscription: Subscription) {
  try {
    await updateSubscription(subscription.id, { active: !subscription.active })
    notify(subscription.active ? 'Paused automatic matching' : 'Resumed automatic matching')
    await load()
  } catch (updateError) {
    error.value = errorMessage(updateError)
  }
}

async function saved() {
  await load()
}
</script>

<template>
  <TabPage name="subscriptions">
    <template v-if="auth.isAdmin && !noSubscriptions" #actions>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Plus"
        data-test="subscription-add"
        @click="add"
      >
        Add subscription
      </v-btn>
    </template>

    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      text="You can see subscriptions. Only an admin can change them."
    />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      title="Couldn't load or update subscriptions"
      :text="error"
      data-test="subscriptions-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="subscriptions-retry" @click="load">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-if="loading && !loaded" data-test="subscriptions-loading">
      <v-skeleton-loader type="heading, paragraph, card@3" />
    </div>

    <v-card v-else-if="noSubscriptions" rounded="xl" class="subscription-empty">
      <EmptyState
        :icon="Repeat"
        title="Know what’s coming up"
        text="Keep recurring bills and memberships in one place, with reminders before they renew."
      >
        <v-btn
          v-if="auth.isAdmin"
          color="primary"
          variant="flat"
          :prepend-icon="Plus"
          data-test="subscription-add-first"
          @click="add"
        >
          Add your first subscription
        </v-btn>
      </EmptyState>
    </v-card>

    <template v-else-if="loaded">
      <v-row class="mb-2" density="compact">
        <v-col cols="12" md="4">
          <v-card rounded="xl" class="subscription-stat h-100" data-test="subscriptions-count">
            <v-card-text class="d-flex align-center ga-4 pa-5">
              <v-avatar color="primary" variant="tonal" rounded="lg">
                <v-icon :icon="Repeat" />
              </v-avatar>
              <div>
                <p class="text-body-small text-medium-emphasis mb-1">Active subscriptions</p>
                <p class="text-headline-small font-weight-bold ma-0">
                  {{ activeSubscriptions.length }}
                </p>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card rounded="xl" class="subscription-stat h-100" data-test="subscriptions-monthly">
            <v-card-text class="pa-5">
              <p class="text-body-small text-medium-emphasis mb-1">Estimated monthly</p>
              <p
                v-for="total in monthTotals"
                :key="total.currency"
                class="text-headline-small font-weight-bold ma-0"
              >
                {{ formatMoney(total.amount, total.currency) }}
              </p>
              <p v-if="!monthTotals.length" class="text-title-medium font-weight-bold ma-0">—</p>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card rounded="xl" class="subscription-stat h-100" data-test="subscriptions-yearly">
            <v-card-text class="pa-5">
              <p class="text-body-small text-medium-emphasis mb-1">Estimated yearly</p>
              <p
                v-for="total in yearTotals"
                :key="total.currency"
                class="text-headline-small font-weight-bold ma-0"
              >
                {{ formatMoney(total.amount, total.currency) }}
              </p>
              <p v-if="!yearTotals.length" class="text-title-medium font-weight-bold ma-0">—</p>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-alert
        v-if="dueSoon"
        color="warning"
        variant="tonal"
        :icon="CalendarClock"
        class="mb-5"
        data-test="subscriptions-due-alert"
      >
        {{ dueSoon }} {{ dueSoon === 1 ? 'payment is' : 'payments are' }} due within your
        {{ alertDays }}-day reminder window. You can change this in
        <RouterLink to="/settings/alerts" class="text-warning font-weight-bold"
          >Alert settings</RouterLink
        >.
      </v-alert>

      <div class="d-flex flex-column flex-sm-row align-stretch align-sm-center ga-3 mb-5">
        <v-text-field
          v-model="search"
          :prepend-inner-icon="Search"
          label="Search subscriptions"
          density="comfortable"
          variant="outlined"
          hide-details
          clearable
          class="subscription-search"
          data-test="subscription-search"
        />
        <v-btn-toggle
          v-model="activeFilter"
          mandatory
          divided
          variant="outlined"
          color="primary"
          aria-label="Subscription status"
          data-test="subscription-filter"
        >
          <v-btn value="active">Active</v-btn>
          <v-btn value="paused">Paused</v-btn>
        </v-btn-toggle>
      </div>

      <div v-if="!visibleSubscriptions.length" class="subscription-no-results">
        <EmptyState
          :icon="Search"
          title="No matches"
          text="Try a different search or switch between active and paused subscriptions."
          compact
        />
      </div>
      <v-row v-else density="compact">
        <v-col
          v-for="subscription in visibleSubscriptions"
          :key="subscription.id"
          cols="12"
          md="6"
          xl="4"
        >
          <SubscriptionCard
            :subscription="subscription"
            :days-until-due="daysUntil(subscription.next_due_date)"
            :alert-days="alertDays"
            :due-alerts-enabled="alerts?.subscription_due_enabled ?? false"
            :readonly="!auth.isAdmin"
            @edit="edit"
            @delete="remove"
            @toggle="toggle"
          />
        </v-col>
      </v-row>
    </template>

    <SubscriptionDialog
      v-if="auth.isAdmin"
      v-model="dialog"
      :subscription="editing"
      @saved="saved"
    />
  </TabPage>
</template>

<style scoped>
.subscription-stat {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.subscription-empty,
.subscription-no-results {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.subscription-search {
  max-width: 420px;
}

@media (max-width: 599px) {
  .subscription-search {
    max-width: none;
  }
}
</style>
