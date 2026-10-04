<script setup lang="ts">
import { TrendingDown, TrendingUp } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { fetchAutomations, createAutomation, type Automation } from '@/api/automations'
import {
  addBudgetSource,
  linkBudgetTransactions,
  type Budget,
  type BudgetKind,
  type BudgetSource,
} from '@/api/budget'
import type { Transaction } from '@/api/transactions'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import TransactionFinder from '@/components/finance/TransactionFinder.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { formatCount } from '@/utils/format'
import { keyOf, nameFor } from '@/views/automations/looks'
import { frequencyTitle, expectedAmount } from '@/views/subscriptions/recurrence'

/**
 * Adds income or spending to a budget: single transactions (with the option to count every
 * later one like them, which is how a paycheck gets counted each time), or a whole account or
 * category, a subscription, or an automation's transactions.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ budget: Budget; kind: BudgetKind; sources: BudgetSource[] }>()
const emit = defineEmits<{ added: [] }>()

type Tab = 'transactions' | 'account' | 'category' | 'subscription' | 'rule'

const accounts = useAccountsStore()
const categories = useCategoriesStore()
const subscriptions = useSubscriptionsStore()
const { money } = useHousehold()

const tab = ref<Tab>('transactions')
/** Counts openings, so each starts with a fresh search of the transactions. */
const openings = ref(0)
const picked = ref(new Map<string, Transaction>())
const automate = ref(true)
const accountId = ref<string | null>(null)
const categoryId = ref<string | null>(null)
const subscriptionId = ref<string | null>(null)
const automationId = ref<string | null>(null)
const automations = ref<Automation[]>([])

const income = computed(() => props.kind === 'income')
const tabs = computed(() => [
  { value: 'transactions', title: 'Transactions' },
  { value: 'account', title: 'An account' },
  { value: 'category', title: 'A category' },
  ...(income.value ? [] : [{ value: 'subscription', title: 'A subscription' }]),
  { value: 'rule', title: 'A rule' },
])

/** What's counted already, by what it is, so it can't be added twice. */
const counted = (type: BudgetSource['type'], sameKind = false) =>
  new Set(
    props.sources
      .filter((source) => source.type === type && (!sameKind || source.kind === props.kind))
      .map((source) => source.target_id),
  )

const accountItems = computed(() => {
  const taken = counted('account', true)
  return accounts.open
    .filter((account) => !taken.has(account.id))
    .map((account) => ({
      value: account.id,
      title: account.name,
      props: { subtitle: account.institution ?? undefined },
    }))
})
const subscriptionItems = computed(() => {
  const taken = counted('subscription')
  return subscriptions.active
    .filter((item) => !taken.has(item.id))
    .map((item) => ({
      value: item.id,
      title: item.name,
      props: {
        subtitle: `${frequencyTitle(item.frequency)} · ${money(expectedAmount(item), accounts.find(item.account_id)?.currency)}`,
      },
    }))
})
const ruleItems = computed(() => {
  const taken = counted('automation')
  return automations.value
    .filter((item) => !taken.has(item.id))
    .map((item) => ({
      value: item.id,
      title: item.name,
      props: { subtitle: item.payees.join(', ') },
    }))
})

const payees = computed(() => {
  const found = new Map<string, string>()
  for (const transaction of picked.value.values()) {
    found.set(keyOf(transaction.payee), found.get(keyOf(transaction.payee)) ?? transaction.payee)
  }
  return [...found.values()]
})

const ready = computed(
  () =>
    ({
      transactions: picked.value.size > 0,
      account: accountId.value !== null,
      category: categoryId.value !== null,
      subscription: subscriptionId.value !== null,
      rule: automationId.value !== null,
    })[tab.value],
)
const buttons: Record<Tab, string> = {
  transactions: 'Add transactions',
  account: 'Count this account',
  category: 'Count this category',
  subscription: 'Count this subscription',
  rule: 'Count this rule',
}

function toggle(transaction: Transaction) {
  if (picked.value.has(transaction.id)) picked.value.delete(transaction.id)
  else picked.value.set(transaction.id, transaction)
}

function reset() {
  openings.value++
  tab.value = 'transactions'
  picked.value = new Map()
  automate.value = true
  accountId.value = categoryId.value = subscriptionId.value = automationId.value = null
  adding.clear()
}

watch(open, (value) => {
  if (!value) return
  reset()
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  void subscriptions.load()
  void fetchAutomations().then(
    (found) => (automations.value = found),
    () => (automations.value = []),
  )
})

const adding = useAction(async () => {
  const id = props.budget.id
  const kind = props.kind
  const where = props.budget.name
  if (tab.value === 'transactions') {
    const items = [...picked.value.values()]
    if (automate.value) {
      const name = nameFor(payees.value)
      await createAutomation({
        name: `${name} (${where})`.slice(0, 120),
        payees: payees.value,
        match: 'exact',
        account_id: null,
        min_amount: null,
        max_amount: null,
        category_id: null,
        subscription_id: null,
        counts: [{ budget_id: id, kind }],
        apply_to: 'all',
      })
      notify(`Counting ${name} as ${kind} in ${where}, now and from now on`)
    } else {
      await linkBudgetTransactions(
        id,
        items.map((item) => item.id),
        kind,
      )
      notify(`Counted ${formatCount(items.length, 'transaction')} as ${kind} in ${where}`)
    }
  } else {
    const target = {
      account: { account_id: accountId.value ?? undefined },
      category: { category_id: categoryId.value ?? undefined },
      subscription: { subscription_id: subscriptionId.value ?? undefined },
      rule: { automation_id: automationId.value ?? undefined },
    }[tab.value]
    const added = await addBudgetSource(id, { kind, ...target })
    notify(`Counting ${added.name} as ${kind} in ${where}`)
  }
  emit('added')
  open.value = false
})
</script>

<template>
  <AppDialog
    v-model="open"
    :title="income ? 'Add income' : 'Add spending'"
    :subtitle="`Choose what counts as ${kind} in ${budget.name}.`"
    :icon="income ? TrendingUp : TrendingDown"
    :tone="income ? 'success' : 'primary'"
    max-width="720"
    :persistent="adding.busy.value"
    fullscreen-on-mobile
    data-test="budget-link-dialog"
  >
    <v-tabs
      v-model="tab"
      color="primary"
      show-arrows
      density="comfortable"
      class="mb-4"
      aria-label="What to count"
      data-test="link-tabs"
    >
      <v-tab
        v-for="item in tabs"
        :key="item.value"
        :value="item.value"
        :data-test="`link-tab-${item.value}`"
      >
        {{ item.title }}
      </v-tab>
    </v-tabs>

    <section v-if="tab === 'transactions'">
      <p class="text-body-medium text-medium-emphasis mb-3">
        {{
          income
            ? 'Tick the money that came in, like your paycheck.'
            : 'Tick the money that went out, like rent or a bill.'
        }}
      </p>
      <TransactionFinder :key="openings" :direction="income ? 'in' : 'out'">
        <template #prepend="{ transaction }">
          <v-checkbox-btn
            :model-value="picked.has(transaction.id)"
            :aria-label="`Count ${transaction.payee}`"
            density="comfortable"
            data-test="link-pick"
            @update:model-value="toggle(transaction)"
          />
        </template>
      </TransactionFinder>
      <v-card v-if="picked.size" variant="tonal" class="pa-4 mt-4" data-test="link-automate">
        <v-switch
          v-model="automate"
          color="primary"
          hide-details
          density="comfortable"
          label="Count every later one like them, too"
          data-test="link-automate-switch"
        />
        <p class="text-body-small text-medium-emphasis ma-0 mt-1" data-test="link-automate-hint">
          <template v-if="automate">
            Cashcove counts every transaction from {{ nameFor(payees) }}, past and future, whether
            it comes from your bank, a statement file or is added by hand. This makes an automation
            you can change or pause in Automations.
          </template>
          <template v-else>
            Only the {{ picked.size === 1 ? 'transaction' : `${picked.size} transactions` }} you
            ticked count. You can take one off the budget later.
          </template>
        </p>
      </v-card>
    </section>

    <section v-else-if="tab === 'account'">
      <p class="text-body-medium text-medium-emphasis mb-3">
        {{
          income
            ? 'All the money that comes into this account counts as income.'
            : 'All the money that goes out of this account counts as spending.'
        }}
        Moving money between your own accounts, like paying a card, isn't counted.
      </p>
      <v-select
        v-model="accountId"
        :items="accountItems"
        label="Account"
        no-data-text="Every account already counts"
        data-test="link-account"
      />
    </section>

    <section v-else-if="tab === 'category'">
      <p class="text-body-medium text-medium-emphasis mb-3">
        Everything in the category counts, from every account. A refund takes away from what was
        spent.
      </p>
      <CategoryPicker v-model="categoryId" label="Category" data-test="link-category" />
    </section>

    <section v-else-if="tab === 'subscription'">
      <p class="text-body-medium text-medium-emphasis mb-3">
        Every payment of the subscription counts, and the ones still to come this period are counted
        ahead.
      </p>
      <v-select
        v-model="subscriptionId"
        :items="subscriptionItems"
        label="Subscription"
        no-data-text="Add a subscription in the Subscriptions tab first"
        data-test="link-subscription"
      />
    </section>

    <section v-else>
      <p class="text-body-medium text-medium-emphasis mb-3">
        Everything an automation finds counts, including what arrives later. Rules are made and
        changed in the Automations tab.
      </p>
      <v-select
        v-model="automationId"
        :items="ruleItems"
        label="Automation"
        no-data-text="Make an automation in the Automations tab first"
        data-test="link-rule"
      />
    </section>

    <v-alert
      v-if="adding.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-4"
      :text="adding.error.value"
      data-test="link-error"
    />

    <template #actions>
      <v-btn variant="text" :disabled="adding.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="adding.busy.value"
        :disabled="!ready"
        data-test="link-add"
        @click="adding.run()"
      >
        {{ buttons[tab] }}
      </v-btn>
    </template>
  </AppDialog>
</template>
