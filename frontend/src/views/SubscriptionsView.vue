<script setup lang="ts">
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarX,
  CirclePause,
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
import { useRecurringActions } from '@/composables/useRecurringActions'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { toCents, fromCents } from '@/utils/money'
import SubscriptionCancelDialog from '@/views/subscriptions/SubscriptionCancelDialog.vue'
import SubscriptionCard from '@/views/subscriptions/SubscriptionCard.vue'
import SubscriptionDialog from '@/views/subscriptions/SubscriptionDialog.vue'
import SubscriptionPaymentsDialog from '@/views/subscriptions/SubscriptionPaymentsDialog.vue'
import SubscriptionReactivateDialog from '@/views/subscriptions/SubscriptionReactivateDialog.vue'
import { dueReminder, kinds, partOf, partsOf } from '@/views/subscriptions/kinds'
import {
  daysUntil,
  estimatedAmount,
  expectedAmount,
  paysAgain,
  standing,
  type Standing,
} from '@/views/subscriptions/recurrence'

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
const activeFilter = ref<Standing>('active')
const dialog = ref(false)
const editing = ref<Subscription | null>(null)
const paymentsOpen = ref(false)
const linking = ref<Subscription | null>(null)
const cancelOpen = ref(false)
const cancelling = ref<Subscription | null>(null)
const reactivateOpen = ref(false)
const reactivating = ref<Subscription | null>(null)
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
    const matchesState = standing(subscription) === activeFilter.value
    const query = search.value.trim().toLocaleLowerCase()
    return (
      matchesState &&
      (!query ||
        subscription.name.toLocaleLowerCase().includes(query) ||
        subscription.payee.toLocaleLowerCase().includes(query))
    )
  }),
)
/** The ones being tracked and still paid: paused and cancelled ones don't count toward anything. */
const activeSubscriptions = computed(() =>
  subscriptions.value.filter((item) => standing(item) === 'active'),
)
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

const reminder = computed(() => dueReminder(preferences.saved?.alerts, props.kind))
const alertDays = computed(() => reminder.value.days)
const dueSoon = computed(
  () =>
    reminder.value.enabled &&
    activeSubscriptions.value.filter((item) => {
      const days = daysUntil(item.next_due_date)
      return paysAgain(item) && days >= 0 && days <= alertDays.value
    }).length,
)
/** How many it's still tracking that were due before today and haven't been paid. */
const overdue = computed(
  () => activeSubscriptions.value.filter((item) => daysUntil(item.next_due_date) < 0).length,
)
const noSubscriptions = computed(() => loaded.value && subscriptions.value.length === 0)

/**
 * What an empty list says. A search that finds nothing says so; with no search, a filter with
 * nothing in it says what it is for, so cancelling the last active one doesn't read as a miss.
 */
const emptyList = computed(() => {
  const { noun, nouns } = copy.value
  if (search.value.trim()) {
    return {
      icon: Search,
      title: 'No matches',
      text: `Try a different search or switch between active, paused and cancelled ${nouns}.`,
    }
  }
  return {
    active: {
      icon: copy.value.icon,
      title: `No active ${nouns}`,
      text: 'Everything you track here is paused or cancelled. Pick a filter above to see them.',
    },
    paused: {
      icon: CirclePause,
      title: `No paused ${nouns}`,
      text: `Pause matching from a ${noun}'s menu and it waits here until you resume it.`,
    },
    cancelled: {
      icon: CalendarX,
      title: `No cancelled ${nouns}`,
      text: `Cancel a ${noun} from its menu and it is kept here, with every payment, so you can look back on it later.`,
    },
  }[activeFilter.value]
})

function add() {
  editing.value = null
  dialog.value = true
}

function edit(subscription: Subscription) {
  editing.value = subscription
  dialog.value = true
}

function cancel(subscription: Subscription) {
  cancelling.value = subscription
  cancelOpen.value = true
}

function reactivate(subscription: Subscription) {
  reactivating.value = subscription
  reactivateOpen.value = true
}

function linkPayments(subscription: Subscription) {
  linking.value = subscription
  paymentsOpen.value = true
}

const actions = useRecurringActions(load, (message) => {
  error.value = message
})

async function remove(subscription: Subscription) {
  if (await actions.remove(subscription)) await load()
}

async function saved() {
  await load()
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
          <v-btn value="cancelled">Cancelled</v-btn>
        </v-btn-toggle>
      </div>

      <v-card v-if="!visibleSubscriptions.length" :data-test="parts('none-match')">
        <EmptyState
          :icon="emptyList.icon"
          :title="emptyList.title"
          :text="emptyList.text"
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
            @toggle="actions.toggle"
            @cancel="cancel"
            @reactivate="reactivate"
            @link="linkPayments"
            @update-amount="actions.updateAmount"
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
    <SubscriptionCancelDialog
      v-if="auth.isAdmin"
      v-model="cancelOpen"
      :subscription="cancelling"
      @saved="load"
    />
    <SubscriptionReactivateDialog
      v-if="auth.isAdmin"
      v-model="reactivateOpen"
      :subscription="reactivating"
      @saved="load"
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
