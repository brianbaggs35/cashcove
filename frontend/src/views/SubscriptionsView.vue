<script setup lang="ts">
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Plus,
  Search,
  TriangleAlert,
} from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import { errorMessage } from '@/api/client'
import { recurringApi } from '@/api/recurring'
import type { RecurringKind, Subscription } from '@/api/subscriptions'
import TabPage from '@/components/TabPage.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { todayIso } from '@/utils/dates'
import { toCents, fromCents } from '@/utils/money'
import SubscriptionCard from '@/views/subscriptions/SubscriptionCard.vue'
import SubscriptionDialog from '@/views/subscriptions/SubscriptionDialog.vue'
import SubscriptionPaymentsDialog from '@/views/subscriptions/SubscriptionPaymentsDialog.vue'
import { dueReminder, kinds, partOf, partsOf } from '@/views/subscriptions/kinds'
import { estimatedAmount, expectedAmount } from '@/views/subscriptions/recurrence'

/**
 * The page of subscriptions or of bills: tracked, matched to the transactions that pay them and
 * sorted by automations the same way, so both are this page, told apart by `kind`.
 */
const props = withDefaults(defineProps<{ kind?: RecurringKind }>(), { kind: 'subscription' })
const copy = computed(() => kinds[props.kind])
const part = (name: string) => partOf(props.kind, name)
const parts = (name: string) => partsOf(props.kind, name)

const auth = useAuthStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const preferences = usePreferencesStore()
const { money } = useHousehold()
const subscriptions = ref<Subscription[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const activeFilter = ref<'active' | 'paused'>('active')
const dialog = ref(false)
const editing = ref<Subscription | null>(null)
const paymentsOpen = ref(false)
const linking = ref<Subscription | null>(null)
let request = 0

async function load() {
  const current = ++request
  loading.value = true
  error.value = null
  try {
    const result = await recurringApi(props.kind).fetch()
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
    const amount = estimatedAmount(expectedAmount(item), item.frequency, period)
    totals.set(currency, (totals.get(currency) ?? 0) + toCents(amount))
  }
  return [...totals].map(([currency, cents]) => ({ currency, amount: fromCents(cents) }))
}

function daysUntil(date: string) {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000,
  )
}

const reminder = computed(() => dueReminder(preferences.saved?.alerts, props.kind))
const alertDays = computed(() => reminder.value.days)
const dueSoon = computed(
  () =>
    reminder.value.enabled &&
    activeSubscriptions.value.filter((item) => {
      const days = daysUntil(item.next_due_date)
      return days >= 0 && days <= alertDays.value
    }).length,
)
/** How many it's still tracking that were due before today and haven't been paid. */
const overdue = computed(
  () => activeSubscriptions.value.filter((item) => daysUntil(item.next_due_date) < 0).length,
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

function linkPayments(subscription: Subscription) {
  linking.value = subscription
  paymentsOpen.value = true
}

async function remove(subscription: Subscription) {
  const done = await confirmAndRun(
    {
      title: `Delete ${subscription.name}?`,
      text: 'Its tracked transactions will stay in your history, but will no longer be linked.',
      confirmText: `Delete ${copy.value.noun}`,
      tone: 'error',
    },
    () => recurringApi(props.kind).remove(subscription.id),
  )
  if (!done) return
  notify(`Deleted ${subscription.name}`)
  await load()
}

async function toggle(subscription: Subscription) {
  try {
    await recurringApi(props.kind).update(subscription.id, { active: !subscription.active })
    notify(subscription.active ? 'Paused automatic matching' : 'Resumed automatic matching')
    await load()
  } catch (updateError) {
    error.value = errorMessage(updateError)
  }
}

async function saved() {
  await load()
}

/** A price rise, say: the amount a payment really was becomes the subscription's. */
async function updateAmount(subscription: Subscription) {
  if (subscription.last_payment_amount === null) return
  try {
    await recurringApi(props.kind).update(subscription.id, {
      amount: subscription.last_payment_amount,
    })
    notify(`Updated ${subscription.name} to ${money(subscription.last_payment_amount)}`)
    await load()
  } catch (updateError) {
    error.value = errorMessage(updateError)
  }
}
</script>

<template>
  <TabPage :name="copy.tab">
    <template v-if="auth.isAdmin && !noSubscriptions" #actions>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Plus"
        :data-test="part('add')"
        @click="add"
      >
        Add {{ copy.noun }}
      </v-btn>
    </template>

    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      :text="`You can see ${copy.nouns}. Only an admin can change them.`"
    />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :title="`Couldn't load or update ${copy.nouns}`"
      :text="error"
      :data-test="parts('error')"
    >
      <template #append>
        <v-btn variant="text" size="small" :data-test="parts('retry')" @click="load">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-if="loading && !loaded" :data-test="parts('loading')">
      <v-skeleton-loader type="heading, paragraph, card@3" class="rounded-xl" />
    </div>

    <v-card v-else-if="noSubscriptions">
      <EmptyState :icon="copy.icon" :title="copy.empty.title" :text="copy.empty.text">
        <v-btn
          v-if="auth.isAdmin"
          color="primary"
          variant="flat"
          :prepend-icon="Plus"
          :data-test="part('add-first')"
          @click="add"
        >
          Add your first {{ copy.noun }}
        </v-btn>
      </EmptyState>
    </v-card>

    <template v-else-if="loaded">
      <v-row class="mb-2" density="compact">
        <v-col cols="12" md="4">
          <v-card class="h-100" :data-test="parts('count')">
            <v-card-text class="d-flex align-center ga-4 pa-5">
              <v-avatar color="primary" variant="tonal" rounded="lg">
                <v-icon :icon="copy.icon" />
              </v-avatar>
              <div>
                <p class="text-body-small text-medium-emphasis mb-1">Active {{ copy.nouns }}</p>
                <p class="text-headline-small font-weight-bold ma-0">
                  {{ activeSubscriptions.length }}
                </p>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card class="h-100" :data-test="parts('monthly')">
            <v-card-text class="d-flex align-center ga-4 pa-5">
              <v-avatar color="primary" variant="tonal" rounded="lg">
                <v-icon :icon="CalendarDays" />
              </v-avatar>
              <div>
                <p class="text-body-small text-medium-emphasis mb-1">Estimated monthly</p>
                <p
                  v-for="total in monthTotals"
                  :key="total.currency"
                  class="text-headline-small font-weight-bold ma-0"
                >
                  {{ money(total.amount, total.currency) }}
                </p>
                <p v-if="!monthTotals.length" class="text-headline-small font-weight-bold ma-0">
                  —
                </p>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card class="h-100" :data-test="parts('yearly')">
            <v-card-text class="d-flex align-center ga-4 pa-5">
              <v-avatar color="primary" variant="tonal" rounded="lg">
                <v-icon :icon="CalendarRange" />
              </v-avatar>
              <div>
                <p class="text-body-small text-medium-emphasis mb-1">Estimated yearly</p>
                <p
                  v-for="total in yearTotals"
                  :key="total.currency"
                  class="text-headline-small font-weight-bold ma-0"
                >
                  {{ money(total.amount, total.currency) }}
                </p>
                <p v-if="!yearTotals.length" class="text-headline-small font-weight-bold ma-0">—</p>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-alert
        v-if="overdue"
        color="error"
        variant="tonal"
        :icon="TriangleAlert"
        class="mb-5"
        :data-test="parts('overdue-alert')"
      >
        {{ overdue }} {{ overdue === 1 ? `${copy.noun} is` : `${copy.nouns} are` }} past
        {{ overdue === 1 ? 'its' : 'their' }} due date without a payment linked. Link the payment,
        or change the date if it was paid another way.
      </v-alert>

      <v-alert
        v-if="dueSoon"
        color="warning"
        variant="tonal"
        :icon="CalendarClock"
        class="mb-5"
        :data-test="parts('due-alert')"
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
          :label="`Search ${copy.nouns}`"
          hide-details
          clearable
          class="subscription-search"
          :data-test="part('search')"
        />
        <v-btn-toggle
          v-model="activeFilter"
          mandatory
          divided
          variant="outlined"
          color="primary"
          :aria-label="`${copy.title} status`"
          :data-test="part('filter')"
        >
          <v-btn value="active">Active</v-btn>
          <v-btn value="paused">Paused</v-btn>
        </v-btn-toggle>
      </div>

      <v-card v-if="!visibleSubscriptions.length" :data-test="parts('none-match')">
        <EmptyState
          :icon="Search"
          title="No matches"
          :text="`Try a different search or switch between active and paused ${copy.nouns}.`"
          compact
        />
      </v-card>
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
            :due-alerts-enabled="reminder.enabled"
            :readonly="!auth.isAdmin"
            @edit="edit"
            @delete="remove"
            @toggle="toggle"
            @link="linkPayments"
            @update-amount="updateAmount"
          />
        </v-col>
      </v-row>
    </template>

    <SubscriptionDialog
      v-if="auth.isAdmin"
      v-model="dialog"
      :subscription="editing"
      :kind="kind"
      @saved="saved"
    />
    <SubscriptionPaymentsDialog
      v-if="auth.isAdmin"
      v-model="paymentsOpen"
      :subscription="linking"
      @changed="load"
    />
  </TabPage>
</template>

<style scoped>
.subscription-search {
  max-width: 420px;
}

@media (max-width: 599px) {
  .subscription-search {
    max-width: none;
  }
}
</style>
