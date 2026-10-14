<script setup lang="ts">
import {
  CalendarClock,
  CircleCheck,
  CirclePause,
  CirclePlay,
  EllipsisVertical,
  Link2,
  Pencil,
  SearchX,
  Trash2,
  TriangleAlert,
} from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, errorMessage } from '@/api/client'
import { recurringApi } from '@/api/recurring'
import type { RecurringKind, RecurringOverview, Subscription } from '@/api/subscriptions'
import PageHeader from '@/components/PageHeader.vue'
import BreadcrumbTrail from '@/components/ui/BreadcrumbTrail.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useRecurringActions } from '@/composables/useRecurringActions'
import { findNavItem, type NavItem } from '@/navigation'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { todayIso } from '@/utils/dates'
import { dueText } from '@/views/dashboard/summary'
import SubscriptionDetails from '@/views/subscriptions/SubscriptionDetails.vue'
import SubscriptionDialog from '@/views/subscriptions/SubscriptionDialog.vue'
import SubscriptionPaymentsDialog from '@/views/subscriptions/SubscriptionPaymentsDialog.vue'
import SubscriptionPayments from '@/views/subscriptions/SubscriptionPayments.vue'
import SubscriptionRelated from '@/views/subscriptions/SubscriptionRelated.vue'
import SubscriptionStats from '@/views/subscriptions/SubscriptionStats.vue'
import UpcomingPayments from '@/views/subscriptions/UpcomingPayments.vue'
import { dueReminder, kinds } from '@/views/subscriptions/kinds'
import { daysUntil, frequencyTitle, priceChange } from '@/views/subscriptions/recurrence'

/**
 * One subscription or bill in full: what it costs and when it falls due, every payment linked to
 * it, what is coming, and the automations and budgets that refer to it. Admins can change it,
 * pause it, link payments to it or delete it from here.
 */
const props = defineProps<{ kind: RecurringKind; id: string }>()

const router = useRouter()
const auth = useAuthStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const preferences = usePreferencesStore()
const { money } = useHousehold()

const copy = computed(() => kinds[props.kind])
/** The tab it is in: the first of the pages above it. */
const tab = computed(() => findNavItem(copy.value.tab))
const overview = ref<RecurringOverview | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** It isn't there: it was deleted, or the address never was one. */
const missing = ref(false)
/** Counts loads, so what lists its payments starts again whenever it has been loaded afresh. */
const loads = ref(0)
const editing = ref(false)
const linking = ref(false)
let request = 0

async function load() {
  const current = ++request
  loading.value = true
  error.value = null
  try {
    const result = await recurringApi(props.kind).overview(props.id, todayIso())
    if (current !== request) return
    overview.value = result
    missing.value = false
    loads.value++
  } catch (loadError) {
    if (current !== request) return
    // A malformed address is as good as one that was never there.
    if (loadError instanceof ApiError && [404, 422].includes(loadError.status)) {
      overview.value = null
      missing.value = true
    } else {
      error.value = errorMessage(loadError)
    }
  } finally {
    if (current === request) loading.value = false
  }
}

onMounted(() => {
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  if (!preferences.saved) void preferences.load()
})

// Going from one to another shows that one, not the last until it arrives.
watch(
  () => [props.kind, props.id],
  () => {
    overview.value = null
    missing.value = false
    void load()
  },
  { immediate: true },
)

// What follows is only read once it has loaded: the page shows nothing of it before.
const subscription = computed(() => (overview.value as RecurringOverview).subscription)
const account = computed(() => accounts.find(subscription.value.account_id))
const days = computed(() => daysUntil(subscription.value.next_due_date))
const reminder = computed(() => dueReminder(preferences.saved?.alerts, props.kind))
const overdue = computed(() => subscription.value.active && days.value < 0)
const dueSoon = computed(
  () =>
    subscription.value.active &&
    reminder.value.enabled &&
    days.value >= 0 &&
    days.value <= reminder.value.days,
)
const changedPrice = computed(() => priceChange(subscription.value))

/** The page's header: the tab's, with this one's name and where it's paid from. */
const header = computed<NavItem>(() => ({
  ...findNavItem(copy.value.tab),
  title: subscription.value.name,
  summary: `${subscription.value.payee} · ${account.value?.name ?? 'Account unavailable'}`,
}))

/** What the trail calls this page: its name once known, and what it is until then. */
const crumb = computed(() => {
  if (overview.value) return subscription.value.name
  return missing.value ? 'Not found' : copy.value.title
})

watch(
  () => overview.value?.subscription.name,
  (name) => {
    if (name) document.title = [name, copy.value.title, 'Cashcove'].join(' · ')
  },
)

const actions = useRecurringActions(load, (message) => {
  error.value = message
})

async function remove(item: Subscription) {
  if (await actions.remove(item)) await router.replace({ name: copy.value.tab })
}
</script>

<template>
  <div data-test="subscription-show">
    <BreadcrumbTrail
      :trail="[{ title: tab.title, to: { name: copy.tab } }]"
      :current="crumb"
      class="mb-4"
      data-test="show-breadcrumbs"
    />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :title="`Couldn't load or update this ${copy.noun}`"
      :text="error"
      data-test="show-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="show-retry" @click="load">Try again</v-btn>
      </template>
    </v-alert>

    <v-skeleton-loader
      v-if="loading && !overview"
      type="heading, paragraph, card@3"
      class="rounded-xl"
      data-test="show-loading"
    />

    <v-card v-else-if="missing" data-test="show-missing">
      <EmptyState
        :icon="SearchX"
        :title="`That ${copy.noun} doesn’t exist anymore`"
        :text="`It may have been deleted. Your ${copy.nouns} are all on their own page.`"
      >
        <v-btn color="primary" variant="flat" :to="{ name: copy.tab }">
          Go to {{ copy.nouns }}
        </v-btn>
      </EmptyState>
    </v-card>

    <template v-else-if="overview">
      <ReadOnlyNotice
        v-if="!auth.isAdmin"
        :text="`You can see this ${copy.noun}. Only an admin can change it.`"
      />

      <PageHeader :item="header">
        <template #meta>
          <v-chip
            :color="subscription.active ? 'success' : 'secondary'"
            :prepend-icon="subscription.active ? CircleCheck : CirclePause"
            size="small"
            variant="tonal"
            data-test="show-status"
          >
            {{ subscription.active ? 'Active' : 'Paused' }}
          </v-chip>
          <v-chip size="small" variant="tonal" data-test="show-frequency">
            {{ frequencyTitle(subscription.frequency) }}
          </v-chip>
          <v-chip v-if="subscription.amount_varies" size="small" variant="tonal">
            Amount varies
          </v-chip>
        </template>
        <template v-if="auth.isAdmin" #actions>
          <v-btn
            variant="tonal"
            :prepend-icon="Link2"
            data-test="show-link-payments"
            @click="linking = true"
          >
            Link payments
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :prepend-icon="Pencil"
            data-test="show-edit"
            @click="editing = true"
          >
            Edit
          </v-btn>
          <v-menu location="bottom end">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                :icon="EllipsisVertical"
                variant="text"
                :aria-label="`More actions for ${subscription.name}`"
                data-test="show-actions"
              />
            </template>
            <v-list density="compact" nav min-width="200">
              <v-list-item
                :prepend-icon="subscription.active ? CirclePause : CirclePlay"
                :title="subscription.active ? 'Pause matching' : 'Resume matching'"
                data-test="show-toggle"
                @click="actions.toggle(subscription)"
              />
              <v-list-item
                :prepend-icon="Trash2"
                title="Delete"
                base-color="error"
                data-test="show-delete"
                @click="remove(subscription)"
              />
            </v-list>
          </v-menu>
        </template>
      </PageHeader>

      <v-alert
        v-if="!subscription.active"
        color="secondary"
        variant="tonal"
        :icon="CirclePause"
        class="mb-4"
        data-test="show-paused-alert"
      >
        <p class="ma-0">
          Paused. Cashcove isn’t linking new payments to this {{ copy.noun }}, and won’t remind you
          when it falls due.
        </p>
        <div v-if="auth.isAdmin" class="show-alert__actions">
          <v-btn
            variant="text"
            size="small"
            data-test="show-resume"
            @click="actions.toggle(subscription)"
          >
            Resume matching
          </v-btn>
        </div>
      </v-alert>

      <v-alert
        v-if="overdue"
        color="error"
        variant="tonal"
        :icon="TriangleAlert"
        class="mb-4"
        data-test="show-overdue-alert"
      >
        <p class="ma-0">
          {{ dueText(days) }} without a payment linked. Link the payment, or change the date if it
          was paid another way.
        </p>
        <div v-if="auth.isAdmin" class="show-alert__actions">
          <v-btn variant="text" size="small" data-test="show-overdue-link" @click="linking = true">
            Link payments
          </v-btn>
          <v-btn variant="text" size="small" data-test="show-overdue-edit" @click="editing = true">
            Change the date
          </v-btn>
        </div>
      </v-alert>

      <v-alert
        v-else-if="dueSoon"
        color="warning"
        variant="tonal"
        :icon="CalendarClock"
        class="mb-4"
        data-test="show-due-alert"
      >
        {{ dueText(days) }}, within your {{ reminder.days }}-day reminder window.
      </v-alert>

      <v-alert
        v-if="changedPrice"
        type="info"
        variant="tonal"
        class="mb-4"
        data-test="show-price-change"
      >
        <p class="ma-0">
          The last payment was {{ money(changedPrice, account?.currency) }}, not
          {{ money(subscription.amount, account?.currency) }}.
        </p>
        <div v-if="auth.isAdmin" class="show-alert__actions">
          <v-btn
            variant="text"
            size="small"
            data-test="show-update-amount"
            @click="actions.updateAmount(subscription)"
          >
            Update amount
          </v-btn>
        </div>
      </v-alert>

      <SubscriptionStats
        :subscription="subscription"
        :summary="overview.summary"
        :currency="account?.currency"
        class="mb-2"
      />

      <v-row density="compact">
        <v-col cols="12" md="7">
          <SubscriptionPayments
            :subscription="subscription"
            :summary="overview.summary"
            :history="overview.history"
            :readonly="!auth.isAdmin"
            :refresh="loads"
            @link="linking = true"
            @changed="load"
          />
        </v-col>
        <v-col cols="12" md="5" class="d-flex flex-column ga-4">
          <UpcomingPayments
            :upcoming="overview.upcoming"
            :varies="subscription.amount_varies"
            :paused="!subscription.active"
            :currency="account?.currency"
          />
          <SubscriptionDetails
            :subscription="subscription"
            :account="account"
            :reminder="reminder"
          />
          <SubscriptionRelated
            :kind="kind"
            :automations="overview.automations"
            :budgets="overview.budgets"
          />
        </v-col>
      </v-row>

      <SubscriptionDialog
        v-if="auth.isAdmin"
        v-model="editing"
        :subscription="subscription"
        :kind="kind"
        @saved="load"
      />
      <SubscriptionPaymentsDialog
        v-if="auth.isAdmin"
        v-model="linking"
        :subscription="subscription"
        @changed="load"
      />
    </template>
  </div>
</template>

<style scoped>
/* Under the message, since beside it they'd squeeze it into a column of single words on a phone. */
.show-alert__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 8px 0 0 -8px;
}
</style>
