<script setup lang="ts">
import {
  Pencil,
  Plus,
  Repeat,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  WandSparkles,
} from '@lucide/vue'
import { computed, onScopeDispose, reactive, ref, watch } from 'vue'

import {
  createAutomation,
  previewAutomation,
  updateAutomation,
  type Automation,
  type AutomationCount,
  type AutomationInput,
  type AutomationMatch,
  type AutomationPreview,
  type AutomationSaved,
  type AutomationScope,
} from '@/api/automations'
import type { Transaction } from '@/api/transactions'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import TransactionFinder from '@/components/finance/TransactionFinder.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import StepList from '@/components/ui/StepList.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useBudgetsStore } from '@/stores/budgets'
import { useCategoriesStore } from '@/stores/categories'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { formatCount } from '@/utils/format'
import {
  amountFields,
  amountLimits,
  amountPhrase,
  amountRange,
  amountsValid,
  keyOf,
  matchItems,
  matchPhrases,
  matchTitles,
  nameFor,
  type AmountMode,
} from '@/views/automations/looks'
import { periodTitles } from '@/views/budget/periods'
import { expectedAmount, frequencyTitle } from '@/views/subscriptions/recurrence'

/**
 * Adds an automation, or changes one, in two steps. The first finds the transactions: ticked
 * from the list, or typed as text to look for, and fine-tuned by how they're compared, where and
 * for how much. The second says what happens to them and whether it reaches back to ones
 * already there. Transactions picked elsewhere, like on the Transactions tab, start it off.
 */
const open = defineModel<boolean>({ required: true })
const props = withDefaults(defineProps<{ automation: Automation | null; seed?: Transaction[] }>(), {
  seed: () => [],
})
const emit = defineEmits<{ saved: [automation: AutomationSaved] }>()

const accounts = useAccountsStore()
const categories = useCategoriesStore()
const subscriptions = useSubscriptionsStore()
const budgets = useBudgetsStore()
const { money } = useHousehold()

interface AutomationForm {
  name: string
  payees: string[]
  match: AutomationMatch
  accountId: string | null
  amountMode: AmountMode
  amountExact: string | null
  amountFrom: string | null
  amountTo: string | null
  categoryId: string | null
  subscriptionId: string | null
  /** The budgets it counts what it sorts toward, as income and as spending. */
  incomeBudgets: string[]
  spendingBudgets: string[]
  applyTo: AutomationScope
}

const form = reactive<AutomationForm>({
  name: '',
  payees: [],
  match: 'exact',
  accountId: null,
  amountMode: 'any',
  amountExact: null,
  amountFrom: null,
  amountTo: null,
  categoryId: null,
  subscriptionId: null,
  incomeBudgets: [],
  spendingBudgets: [],
  applyTo: 'all',
})
const steps = ['Find transactions', 'What to do']
const step = ref(0)
const valid = ref(false)
/** Counts openings, so each starts with a fresh search of the transactions. */
const openings = ref(0)
/** Until the name is typed, it follows what the automation looks for. */
const nameTyped = ref(false)
const typed = ref('')
/** The transactions ticked, by ID, which say how much the ones to sort were for. */
const ticked = ref(new Map<string, Transaction>())
const preview = ref<AutomationPreview | null>(null)
let previewRequest = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined

const chosen = computed(() => new Set(form.payees.map(keyOf)))

const accountItems = computed(() => {
  const items = [...accounts.open]
  const current = accounts.find(props.automation?.account_id)
  if (current && !items.some((item) => item.id === current.id)) items.unshift(current)
  return items.map((item) => ({
    value: item.id,
    title: item.name,
    props: { subtitle: item.institution ?? undefined },
  }))
})
const subscriptionItems = computed(() =>
  subscriptions.subscriptions
    .filter((item) => item.active || item.id === props.automation?.subscription_id)
    .map((item) => ({
      value: item.id,
      title: item.name,
      props: {
        subtitle: `${frequencyTitle(item.frequency)} · ${money(expectedAmount(item), accounts.find(item.account_id)?.currency)}`,
      },
    })),
)

const budgetItems = computed(() =>
  budgets.budgets.map((item) => ({
    value: item.id,
    title: item.name,
    props: { subtitle: periodTitles[item.period] },
  })),
)
/** The budgets it counts toward, as the API takes them. */
const counts = computed<AutomationCount[]>(() => [
  ...form.incomeBudgets.map((id) => ({ budget_id: id, kind: 'income' as const })),
  ...form.spendingBudgets.map((id) => ({ budget_id: id, kind: 'spending' as const })),
])

/** A budget counts as income or as spending, not both, so choosing it for one takes it from the other. */
function countIn(kind: 'income' | 'spending', ids: string[]) {
  if (kind === 'income') {
    form.incomeBudgets = ids
    form.spendingBudgets = form.spendingBudgets.filter((id) => !ids.includes(id))
  } else {
    form.spendingBudgets = ids
    form.incomeBudgets = form.incomeBudgets.filter((id) => !ids.includes(id))
  }
}

const title = computed(() => (props.automation ? 'Edit automation' : 'New automation'))
const subtitle = computed(() =>
  step.value === 0
    ? 'Tick transactions, or type what to look for. Cashcove finds every transaction like them, from Plaid or from a statement file.'
    : 'Say what happens to the transactions it finds, and whether it reaches back to ones you already have.',
)
const nameRules = [
  (value: string) => value.trim().length > 0 || 'Give this automation a name',
  (value: string) => value.trim().length <= 120 || 'Keep it under 120 characters',
]
const limits = computed(() =>
  amountLimits(form.amountMode, form.amountExact, form.amountFrom, form.amountTo),
)
const amountsOk = computed(() =>
  amountsValid(form.amountMode, form.amountExact, form.amountFrom, form.amountTo),
)
const amountProblem = computed(() =>
  form.amountMode === 'between' &&
  form.amountFrom !== null &&
  form.amountTo !== null &&
  !amountsOk.value
    ? "The smallest amount can't be more than the largest."
    : undefined,
)
const hasAction = computed(
  () => form.categoryId !== null || form.subscriptionId !== null || counts.value.length > 0,
)
const canContinue = computed(() => form.payees.length > 0 && amountsOk.value)
const canSave = computed(() => valid.value && canContinue.value && hasAction.value)
const tickedRange = computed(() =>
  amountRange([...ticked.value.values()].map((transaction) => transaction.amount)),
)
/** What the ticked transactions were for, e.g. "$4.50 to $84.12". */
const tickedAmounts = computed(() => {
  const range = tickedRange.value
  if (!range) return null
  return range.min === range.max ? money(range.min) : `${money(range.min)} to ${money(range.max)}`
})
const overlaps = computed(() => preview.value?.overlaps ?? [])
const matching = computed(() => {
  const count = preview.value?.matching
  if (count === undefined) return null
  return count === 1
    ? 'Matches 1 transaction you have now.'
    : `Matches ${count.toLocaleString()} transactions you have now.`
})
const fieldError = (field: string) => saving.fields.value[field] ?? undefined

/** How the automation is set up, in a line, for the panel that fine-tunes it. */
const fineTuning = computed(() =>
  [
    matchTitles[form.match],
    accounts.find(form.accountId)?.name ?? 'any account',
    amountPhrase(limits.value, money) ?? 'any amount',
  ].join(' · '),
)

/** The automation as a sentence: what it looks for, then what it does. */
const rule = computed(() => {
  const where = accounts.find(form.accountId)?.name ?? 'any account'
  const texts = form.payees.map((payee) => `“${payee}”`).join(', ')
  const amounts = amountPhrase(limits.value, money)
  const does = []
  const category = categories.find(form.categoryId)
  if (category) does.push(`put them in ${category.emoji} ${category.name}`)
  if (form.subscriptionId) {
    does.push(
      `link payments to ${subscriptions.find(form.subscriptionId)?.name ?? 'the subscription'}`,
    )
  }
  for (const [kind, ids] of [
    ['income', form.incomeBudgets],
    ['spending', form.spendingBudgets],
  ] as const) {
    if (ids.length) {
      const names = ids.map((id) => budgets.find(id)?.name ?? 'a budget').join(' and ')
      does.push(`count them as ${kind} in ${names}`)
    }
  }
  const forAmounts = amounts ? `, for ${amounts}` : ''
  return {
    when: `${matchPhrases[form.match]} ${texts}, in ${where}${forAmounts}`,
    then: does.length ? does.join(' and ') : 'nothing yet',
  }
})

function sync(next: string[]) {
  form.payees = next
  if (!nameTyped.value) form.name = nameFor(next)
}

function addPayee(text: string, transaction?: Transaction) {
  const clean = text.trim()
  if (transaction) ticked.value.set(transaction.id, transaction)
  if (clean && !chosen.value.has(keyOf(clean))) sync([...form.payees, clean])
}

function removePayee(key: string) {
  for (const [id, transaction] of ticked.value) {
    if (keyOf(transaction.payee) === key) ticked.value.delete(id)
  }
  sync(form.payees.filter((payee) => keyOf(payee) !== key))
}

function togglePick(transaction: Transaction) {
  const key = keyOf(transaction.payee)
  if (chosen.value.has(key)) removePayee(key)
  else addPayee(transaction.payee, transaction)
}

function addTyped() {
  addPayee(typed.value)
  typed.value = ''
}

/** Looks for the amounts the ticked transactions were for: the one amount, or the range between. */
function useTickedAmounts() {
  const range = tickedRange.value
  Object.assign(form, range && amountFields(range.min, range.max))
}

function reset() {
  const automation = props.automation
  step.value = 0
  typed.value = ''
  ticked.value = new Map()
  form.name = automation?.name ?? ''
  form.payees = [...(automation?.payees ?? [])]
  form.match = automation?.match ?? 'exact'
  form.accountId = automation?.account_id ?? null
  Object.assign(form, amountFields(automation?.min_amount ?? null, automation?.max_amount ?? null))
  form.categoryId = automation?.category_id ?? null
  form.subscriptionId = automation?.subscription_id ?? null
  const saved = automation?.counts ?? []
  form.incomeBudgets = saved.filter((item) => item.kind === 'income').map((item) => item.budget_id)
  form.spendingBudgets = saved
    .filter((item) => item.kind === 'spending')
    .map((item) => item.budget_id)
  form.applyTo = automation?.apply_to ?? 'all'
  nameTyped.value = automation !== null
  preview.value = null
  saving.clear()
  // Transactions picked elsewhere start a new automation off.
  if (!automation) for (const transaction of props.seed) addPayee(transaction.payee, transaction)
}

/** What the automation would sort and which others overlap it, as the form changes. */
async function refreshPreview() {
  const request = ++previewRequest
  if (!form.payees.length || !amountsOk.value) {
    preview.value = null
    return
  }
  try {
    const result = await previewAutomation({
      payees: form.payees,
      match: form.match,
      accountId: form.accountId,
      minAmount: limits.value.min,
      maxAmount: limits.value.max,
      automationId: props.automation?.id ?? null,
      category: form.categoryId !== null,
      subscription: form.subscriptionId !== null,
    })
    if (request === previewRequest) preview.value = result
  } catch {
    // The preview only informs; saving reports anything that's wrong.
    if (request === previewRequest) preview.value = null
  }
}

watch(open, (value) => {
  if (!value) return
  openings.value++
  reset()
  void subscriptions.load()
  void budgets.load()
})
watch(
  [
    () => form.payees,
    () => form.match,
    () => form.accountId,
    () => limits.value.min,
    () => limits.value.max,
    () => form.categoryId !== null,
    () => form.subscriptionId !== null,
  ],
  () => {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => void refreshPreview(), 250)
  },
)
onScopeDispose(() => {
  clearTimeout(previewTimer)
})
// What the API turned down no longer applies once the form changes, so it can be sent again.
watch(form, () => {
  saving.clear()
})

function savedMessage(saved: AutomationSaved, created: boolean): string {
  const base = created ? `Added ${saved.name}` : `Saved ${saved.name}`
  if (!saved.applied) return base
  return `${base} and sorted ${formatCount(saved.applied, 'transaction')}`
}

const saving = useAction(async () => {
  const input: AutomationInput = {
    name: form.name.trim(),
    payees: form.payees,
    match: form.match,
    account_id: form.accountId,
    min_amount: limits.value.min,
    max_amount: limits.value.max,
    category_id: form.categoryId,
    subscription_id: form.subscriptionId,
    counts: counts.value,
    apply_to: form.applyTo,
  }
  const saved = props.automation
    ? await updateAutomation(props.automation.id, input)
    : await createAutomation(input)
  notify(savedMessage(saved, !props.automation))
  emit('saved', saved)
  open.value = false
})

function next() {
  if (canContinue.value) step.value = 1
}

function submit() {
  if (step.value === 0) next()
  else if (canSave.value) void saving.run()
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="title"
    :subtitle="subtitle"
    :icon="automation ? Pencil : WandSparkles"
    :persistent="saving.busy.value"
    max-width="760"
    fullscreen-on-mobile
    data-test="automation-dialog"
  >
    <StepList :steps="steps" :current="step" class="mb-5" />
    <v-form v-model="valid" @submit.prevent="submit">
      <section v-show="step === 0" aria-labelledby="automation-find-heading">
        <h3 id="automation-find-heading" class="text-title-small font-weight-bold mb-2">
          Which transactions?
        </h3>
        <v-text-field
          v-model="typed"
          label="Type text to look for"
          placeholder="e.g. Netflix"
          :hint="`${matchTitles[form.match]} …, in the payee or in what the bank called it. Press Enter to add it.`"
          persistent-hint
          autocomplete="off"
          class="mb-3"
          data-test="automation-text"
          @keydown.enter.prevent="addTyped"
        >
          <template #append-inner>
            <v-btn
              variant="text"
              size="small"
              color="primary"
              :prepend-icon="Plus"
              :disabled="!typed.trim()"
              data-test="automation-text-add"
              @click="addTyped"
            >
              Add
            </v-btn>
          </template>
        </v-text-field>
        <div class="d-flex flex-wrap ga-1 mb-1" data-test="automation-chosen">
          <v-chip
            v-for="payee in form.payees"
            :key="payee"
            size="small"
            variant="tonal"
            closable
            :close-label="`Remove ${payee}`"
            data-test="automation-chosen-payee"
            @click:close="removePayee(keyOf(payee))"
          >
            {{ payee }}
          </v-chip>
        </div>
        <p class="text-body-small text-medium-emphasis mb-3" data-test="automation-preview">
          <template v-if="!form.payees.length">
            Nothing yet. Tick a transaction below, or type what to look for.
          </template>
          <template v-else>{{ matching }}</template>
        </p>

        <TransactionFinder :key="openings" uncategorized-switch>
          <template #prepend="{ transaction }">
            <v-checkbox-btn
              :model-value="chosen.has(keyOf(transaction.payee))"
              :aria-label="`Sort ${transaction.payee}`"
              density="comfortable"
              data-test="automation-pick"
              @update:model-value="togglePick(transaction)"
            />
          </template>
        </TransactionFinder>

        <v-expansion-panels class="mt-4" variant="accordion" data-test="automation-fine-tune">
          <v-expansion-panel eager elevation="0" class="automation-fine-tune">
            <v-expansion-panel-title>
              <div>
                <div class="text-title-small font-weight-bold">Fine-tune matching</div>
                <div class="text-body-small text-medium-emphasis" data-test="automation-looks">
                  {{ fineTuning }}
                </div>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-select
                v-model="form.match"
                :items="matchItems"
                label="Match"
                hint="Statement files and banks name the same merchant differently, so “contains” finds it in either."
                persistent-hint
                class="mb-4"
                data-test="automation-match"
              />
              <v-select
                v-model="form.accountId"
                :items="accountItems"
                label="Only in account"
                placeholder="Any account"
                persistent-placeholder
                hint="Leave empty to sort transactions from every account, linked to a bank or not."
                persistent-hint
                clearable
                class="mb-4"
                data-test="automation-account"
              />
              <p class="text-label-large mb-2">Amount</p>
              <v-btn-toggle
                v-model="form.amountMode"
                mandatory
                divided
                variant="outlined"
                color="primary"
                density="comfortable"
                aria-label="Which amounts to match"
                class="mb-3"
                data-test="automation-amount-mode"
              >
                <v-btn value="any">Any amount</v-btn>
                <v-btn value="exactly">Exactly</v-btn>
                <v-btn value="between">Between</v-btn>
              </v-btn-toggle>
              <MoneyField
                v-if="form.amountMode === 'exactly'"
                v-model="form.amountExact"
                label="Amount"
                required
                non-zero
                data-test="automation-amount"
              />
              <v-row v-else-if="form.amountMode === 'between'" density="compact">
                <v-col cols="12" sm="6">
                  <MoneyField
                    v-model="form.amountFrom"
                    label="From"
                    :error-messages="amountProblem"
                    data-test="automation-amount-from"
                  />
                </v-col>
                <v-col cols="12" sm="6">
                  <MoneyField
                    v-model="form.amountTo"
                    label="To"
                    :error-messages="amountProblem"
                    data-test="automation-amount-to"
                  />
                </v-col>
              </v-row>
              <p class="text-body-small text-medium-emphasis mt-1 mb-0">
                Bills that change every month, like electricity, match any amount. Use an amount
                when one payee bills for several things, like one subscription for $2.99 and another
                for $10.99.
              </p>
              <v-btn
                v-if="tickedAmounts"
                variant="text"
                size="small"
                color="primary"
                class="mt-2 px-1"
                data-test="automation-use-amounts"
                @click="useTickedAmounts"
              >
                Use the amounts you ticked ({{ tickedAmounts }})
              </v-btn>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </section>

      <section v-show="step === 1" aria-labelledby="automation-then-heading">
        <h3 id="automation-then-heading" class="text-title-small font-weight-bold mb-2">
          What should happen?
        </h3>
        <v-card variant="tonal" class="pa-4 mb-4" data-test="automation-summary">
          <dl class="automation-rule ma-0">
            <dt>When</dt>
            <dd data-test="automation-when">{{ rule.when }}</dd>
            <dt>Then</dt>
            <dd data-test="automation-then">{{ rule.then }}</dd>
          </dl>
        </v-card>

        <v-text-field
          v-model="form.name"
          label="Automation name"
          :rules="nameRules"
          :error-messages="fieldError('name')"
          autocomplete="off"
          data-test="automation-name"
          @update:model-value="nameTyped = true"
        />
        <CategoryPicker
          v-model="form.categoryId"
          label="Put them in the category"
          :error-messages="fieldError('category_id')"
          data-test="automation-category"
        />
        <v-select
          v-model="form.subscriptionId"
          :items="subscriptionItems"
          label="Link payments to the subscription"
          :prepend-inner-icon="Repeat"
          hint="Only payments, money going out, are linked. They count toward its payments and settle its due date."
          persistent-hint
          clearable
          no-data-text="Add a subscription in the Subscriptions tab first"
          :error-messages="fieldError('subscription_id')"
          class="mt-2"
          data-test="automation-subscription"
        />
        <v-select
          :model-value="form.incomeBudgets"
          :items="budgetItems"
          multiple
          chips
          closable-chips
          label="Count as income in budgets"
          :prepend-inner-icon="TrendingUp"
          hint="For money coming in, like a paycheck. It counts in every period by its date, past and future."
          persistent-hint
          no-data-text="Make a budget in the Budget tab first"
          :error-messages="fieldError('counts')"
          class="mt-2"
          data-test="automation-income-budgets"
          @update:model-value="(ids: string[]) => countIn('income', ids)"
        />
        <v-select
          :model-value="form.spendingBudgets"
          :items="budgetItems"
          multiple
          chips
          closable-chips
          label="Count as spending in budgets"
          :prepend-inner-icon="TrendingDown"
          hint="For money going out. It's taken off the budget's amount."
          persistent-hint
          no-data-text="Make a budget in the Budget tab first"
          class="mt-2"
          data-test="automation-spending-budgets"
          @update:model-value="(ids: string[]) => countIn('spending', ids)"
        />
        <p
          v-if="!hasAction"
          class="text-body-small text-medium-emphasis mt-1 mb-0"
          data-test="automation-action-hint"
        >
          Choose a category, a subscription or a budget.
        </p>
        <v-alert
          v-for="overlap in overlaps"
          :key="overlap.automation_id"
          type="info"
          variant="tonal"
          density="compact"
          :icon="TriangleAlert"
          class="mt-3"
          data-test="automation-overlap"
        >
          {{ overlap.automation_name }} already does this for
          {{ overlap.count === 1 ? '1 of them' : `${overlap.count.toLocaleString()} of them` }}. The
          older automation wins where both apply.
        </v-alert>

        <v-radio-group
          v-model="form.applyTo"
          label="Apply to"
          class="mt-4"
          hide-details
          data-test="automation-apply-to"
        >
          <v-radio value="all" color="primary" data-test="automation-apply-all">
            <template #label>
              <div>
                <div class="font-weight-medium">Past and future transactions</div>
                <div class="text-body-small text-medium-emphasis">
                  Sorts the matching transactions you already have, and every new one.
                </div>
              </div>
            </template>
          </v-radio>
          <v-radio value="future" color="primary" class="mt-2" data-test="automation-apply-future">
            <template #label>
              <div>
                <div class="font-weight-medium">Future transactions only</div>
                <div class="text-body-small text-medium-emphasis">
                  Sorts new transactions from now on. What you already have stays as it is.
                </div>
              </div>
            </template>
          </v-radio>
        </v-radio-group>

        <v-alert
          v-if="saving.error.value"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          :text="saving.error.value"
          data-test="automation-error"
        />
      </section>
      <button type="submit" hidden />
    </v-form>
    <template #actions>
      <v-btn
        v-if="step === 1"
        variant="text"
        class="me-auto"
        :disabled="saving.busy.value"
        data-test="automation-back"
        @click="step = 0"
      >
        Back
      </v-btn>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        v-if="step === 0"
        color="primary"
        variant="flat"
        :disabled="!canContinue"
        data-test="automation-next"
        @click="next"
      >
        Next
      </v-btn>
      <v-btn
        v-else
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!canSave"
        data-test="automation-save"
        @click="submit"
      >
        {{ automation ? 'Save changes' : 'Add automation' }}
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.automation-fine-tune {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px !important;
}

.automation-rule {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 16px;
}

.automation-rule dt {
  font-weight: 700;
}

.automation-rule dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
