<script setup lang="ts">
import {
  ArrowRight,
  CircleCheck,
  Columns3,
  FileUp,
  FileX,
  ListChecks,
  Sparkles,
  type LucideIcon,
} from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import type { Account, AccountInput } from '@/api/accounts'
import type { CsvPreview, FileImport, ImportPreview } from '@/api/imports'
import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import StepList from '@/components/ui/StepList.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useAiStore } from '@/stores/ai'
import { useCategoriesStore } from '@/stores/categories'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { useImportWizard } from '@/stores/importWizard'
import { formatDateRange } from '@/utils/dates'
import { sumAmounts } from '@/utils/money'
import AccountDialog from '@/views/accounts/AccountDialog.vue'
import ColumnsStep from '@/views/import/ColumnsStep.vue'
import { balanceShown, transactionCount } from '@/views/import/file'
import ImportAiStep from '@/views/import/ImportAiStep.vue'
import ReviewStep from '@/views/import/ReviewStep.vue'

/**
 * Importing a statement file, one step at a time: matching a CSV file's columns, choosing the
 * account and the rows to import, then importing them. The Import tab starts it with a file.
 */
const open = defineModel<boolean>({ required: true })
/** Asks for another file, when this one couldn't be read. */
const emit = defineEmits<{ 'choose-file': [] }>()

const router = useRouter()
const wizard = useImportWizard()
const ai = useAiStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const subscriptions = useSubscriptionsStore()
const { locale, money } = useHousehold()

const accountOpen = ref(false)

/** The AI has finished with the file's transactions, or couldn't. */
const aiFinished = ref(false)

const csv = computed(() => wizard.format === 'csv')
// Automations sort the rows as they're imported; with AI set up, a last step has it check them.
const steps = computed(() => [
  ...(csv.value ? ['Match columns'] : []),
  'Review',
  'Import',
  ...(ai.reviewsImports ? ['AI second opinion'] : []),
])
const stepIndex = computed(() => {
  if (wizard.step === 'columns') return 0
  const review = csv.value ? 1 : 0
  if (wizard.step === 'ai') return review + 2
  return wizard.step === 'done' ? review + 1 : review
})
const showSteps = computed(() =>
  ['columns', 'review', 'importing', 'done', 'ai'].includes(wizard.step),
)
const stepsDone = computed(
  () => wizard.step === 'done' || (wizard.step === 'ai' && aiFinished.value),
)
const busy = computed(() => wizard.step === 'importing')

const heading = computed((): { title: string; subtitle?: string; icon: LucideIcon } => {
  const file = wizard.fileName
  switch (wizard.step) {
    case 'failed':
      return { title: `Couldn’t import ${file}`, icon: FileX }
    case 'columns':
      return {
        title: 'Match the columns',
        subtitle: 'Say what each column holds. Cashcove remembers it for the bank’s next file.',
        icon: Columns3,
      }
    case 'review':
    case 'importing':
      return {
        title: 'Review and import',
        subtitle: 'Tick the transactions to import. Nothing is saved until you do.',
        icon: ListChecks,
      }
    case 'done':
      return { title: `Imported ${file}`, icon: CircleCheck }
    case 'ai':
      return {
        title: 'AI second opinion',
        subtitle:
          'Your automations sorted what they could. The AI looks over how, and suggests changes. Nothing changes until you accept.',
        icon: Sparkles,
      }
    default:
      return { title: `Reading ${file}`, icon: FileUp }
  }
})

const tone = computed(() => {
  if (wizard.step === 'failed') return 'error'
  return wizard.step === 'done' ? 'success' : 'primary'
})

/** Continue once the date and amount columns are chosen and some rows read. */
const readable = computed(() => {
  const { csv, summary } = wizard.preview as ImportPreview
  return !(csv as CsvPreview).missing.length && summary.rows > summary.invalid
})

const progress = computed(() =>
  wizard.step === 'reading'
    ? `Reading ${wizard.fileName}…`
    : `Importing ${transactionCount(wizard.selected.length)} into ${(wizard.account as Account).name}…`,
)

/** A new account starts with what the file says about it. */
const draft = computed((): Partial<AccountInput> => {
  const file = wizard.preview?.new_account
  return {
    name: file?.name ?? '',
    type: file?.type ?? 'checking',
    institution: file?.institution ?? null,
    mask: file?.mask ?? null,
    currency: file?.currency ?? undefined,
    balance: wizard.preview?.balance?.closing ?? undefined,
  }
})

/** What an account kept by hand has for its balance now, as the Accounts tab shows it. */
function balanceNote(account: Account, record: FileImport): string | null {
  const current = (wizard.preview as ImportPreview).balance?.current
  if (!current || wizard.linked) return null
  const { amount, owed } = balanceShown(account.type, sumAmounts([current, record.balance_change]))
  return `${account.name}’s balance is now ${money(amount, account.currency)}${owed ? ' owed' : ''}.`
}

/** What was imported, once it has been. */
const done = computed(() => {
  const record = wizard.record as FileImport
  const days = formatDateRange({ start: record.first_date, end: record.last_date }, locale.value)
  const account = accounts.find(record.account_id)
  return {
    record,
    account,
    summary: `${transactionCount(record.added)} · ${days}`,
    balance: account ? balanceNote(account, record) : null,
  }
})

/** What importing did, said at the top of the AI's step. */
const aiNotes = computed(() => [`Imported ${done.value.summary}.`, ...doneNotes.value])

const doneNotes = computed(() => {
  const record = wizard.record as FileImport
  const notes = []
  if (record.skipped)
    notes.push(
      record.skipped === 1
        ? 'The file’s other row was left out.'
        : `The file’s other ${record.skipped.toLocaleString('en-US')} rows were left out.`,
    )
  if (record.sorted)
    notes.push(
      record.sorted === 1
        ? 'Your automations sorted 1 of them.'
        : `Your automations sorted ${record.sorted.toLocaleString('en-US')} of them.`,
    )
  if (wizard.formatSave)
    notes.push(`Saved the ${wizard.formatSave.name} format for the bank’s next files.`)
  return notes
})

function seeTransactions() {
  const { id } = wizard.record as FileImport
  open.value = false
  void router.push({ path: '/transactions', query: { import: id } })
}

watch(open, (value) => {
  if (value) {
    aiFinished.value = false
    // Whether AI is set up says whether the import has a last step.
    void ai.ensureLoaded()
    void accounts.ensureLoaded()
    void categories.ensureLoaded()
    // Rows an automation links to a subscription or a bill say which.
    void subscriptions.ensureLoaded()
  } else {
    wizard.cancel()
  }
})
</script>

<template>
  <AppDialog
    v-model="open"
    :title="heading.title"
    :subtitle="heading.subtitle"
    :icon="heading.icon"
    :tone="tone"
    :persistent="busy"
    max-width="760"
    fullscreen-on-mobile
  >
    <StepList v-if="showSteps" :steps="steps" :current="stepIndex" :done="stepsDone" class="mb-5" />

    <v-progress-linear
      v-if="wizard.refreshing && (wizard.step === 'columns' || wizard.step === 'review')"
      indeterminate
      color="primary"
      height="2"
      class="import-dialog__refresh"
      data-test="import-refreshing"
    />

    <v-alert
      v-if="wizard.notice"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-5"
      :text="wizard.notice"
      data-test="import-notice"
    />

    <div
      v-if="wizard.step === 'reading' || wizard.step === 'importing'"
      class="text-center py-10"
      data-test="import-progress"
    >
      <v-progress-circular indeterminate color="primary" size="48" width="4" />
      <output class="d-block text-body-large mt-5">{{ progress }}</output>
    </div>

    <p v-else-if="wizard.step === 'failed'" class="text-body-medium mb-0" data-test="import-failed">
      Check it’s a CSV, OFX, QFX, QBO or QIF file downloaded from your bank, then choose it again.
    </p>

    <ColumnsStep v-else-if="wizard.step === 'columns'" />

    <template v-else-if="wizard.step === 'review'">
      <ReviewStep @add-account="accountOpen = true" />
      <v-alert
        v-if="ai.reviewsImports"
        :icon="Sparkles"
        variant="tonal"
        density="compact"
        class="mt-4"
        data-test="import-ai-note"
      >
        After the import, the AI gives a second opinion on how these were sorted. It only suggests.
      </v-alert>
    </template>

    <ImportAiStep
      v-else-if="wizard.step === 'ai'"
      :review-id="(wizard.record as FileImport).ai_review_id as string"
      :notes="aiNotes"
      @finished="aiFinished = true"
    />

    <div v-else data-test="import-done">
      <div class="d-flex align-center ga-4 mb-5">
        <AccountAvatar v-if="done.account" :type="done.account.type" size="48" />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="text-title-medium font-weight-bold text-break">
            {{ done.account?.name ?? 'Imported' }}
          </div>
          <div class="text-body-medium text-medium-emphasis">{{ done.summary }}</div>
        </div>
        <MoneyAmount
          :amount="done.record.total"
          :currency="done.account?.currency"
          signed
          class="text-title-medium font-weight-bold"
        />
      </div>
      <v-alert type="success" variant="tonal" density="compact" data-test="import-done-note">
        <div>
          The transactions are on the Transactions page, and your budget counts them.
          <template v-if="done.balance">{{ done.balance }}</template>
        </div>
        <div v-for="note in doneNotes" :key="note" class="mt-1">{{ note }}</div>
      </v-alert>
    </div>

    <template #actions>
      <template v-if="wizard.step === 'columns'">
        <v-btn variant="text" data-test="import-cancel" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :append-icon="ArrowRight"
          :disabled="wizard.refreshing || !readable"
          data-test="import-continue"
          @click="wizard.step = 'review'"
        >
          Continue
        </v-btn>
      </template>
      <template v-else-if="wizard.step === 'review'">
        <v-btn
          v-if="csv"
          variant="text"
          class="me-auto"
          data-test="import-back"
          @click="wizard.step = 'columns'"
        >
          Back
        </v-btn>
        <v-btn variant="text" data-test="import-cancel" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!wizard.canImport"
          data-test="import-submit"
          @click="wizard.importRows()"
        >
          Import {{ transactionCount(wizard.selected.length) }}
        </v-btn>
      </template>
      <template v-else-if="wizard.step === 'done' || wizard.step === 'ai'">
        <v-btn variant="text" data-test="import-transactions" @click="seeTransactions">
          See transactions
        </v-btn>
        <v-btn color="primary" variant="flat" data-test="import-finish" @click="open = false">
          Done
        </v-btn>
      </template>
      <template v-else-if="wizard.step === 'failed'">
        <v-btn variant="text" data-test="import-close" @click="open = false">Close</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="FileUp"
          data-test="import-choose-again"
          @click="emit('choose-file')"
        >
          Choose another file
        </v-btn>
      </template>
      <v-btn
        v-else-if="wizard.step === 'reading'"
        variant="text"
        data-test="import-close"
        @click="open = false"
      >
        Cancel
      </v-btn>
    </template>

    <AccountDialog
      v-model="accountOpen"
      :account="null"
      :draft="draft"
      @saved="(account) => wizard.chooseAccount(account.id)"
    />
  </AppDialog>
</template>

<style scoped>
.import-dialog__refresh {
  margin-top: -18px;
  margin-bottom: 16px;
}
</style>
