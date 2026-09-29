<script setup lang="ts">
import {
  ArrowRight,
  CircleCheck,
  ListChecks,
  Plug,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { errorMessage, isCancelled } from '@/api/client'
import {
  chooseAccounts,
  createConnection,
  createLinkToken,
  type Connection,
  type HistoryDays,
} from '@/api/connections'
import { accountType } from '@/components/finance/accountTypes'
import AppDialog from '@/components/ui/AppDialog.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import StepList from '@/components/ui/StepList.vue'
import { notify } from '@/composables/notify'
import { forgetLink, linkErrorMessage, loadLink, openLink, rememberLink } from '@/plaid/link'
import { useAccountsStore } from '@/stores/accounts'
import { useConnectionsStore } from '@/stores/connections'
import { useHealthStore } from '@/stores/health'
import { usePreferencesStore } from '@/stores/preferences'
import { negate } from '@/utils/money'
import AccountPicker from '@/views/connect/AccountPicker.vue'
import BankLogo from '@/views/connect/BankLogo.vue'
import { historyOptions, intervalLabel } from '@/views/settings/syncOptions'

/**
 * Connecting a bank, one step at a time: how much history to bring in, signing in through Plaid
 * Link, choosing which accounts to import, then importing them. With `connection`, it only
 * chooses which of a connected bank's accounts to import.
 */
const open = defineModel<boolean>({ required: true })
const props = withDefaults(
  defineProps<{
    connection?: Connection | null
    /** Picks up connecting a bank after its own sign-in page sent people back to Cashcove. */
    resume?: { token: string; historyDays: HistoryDays | null; redirectUri: string } | null
  }>(),
  { connection: null, resume: null },
)

type Step = 'start' | 'opening' | 'linking' | 'saving' | 'accounts' | 'importing' | 'done'

const router = useRouter()
const store = useConnectionsStore()
const accounts = useAccountsStore()
const preferences = usePreferencesStore()
const health = useHealthStore()

const step = ref<Step>('start')
const historyDays = ref<HistoryDays>(730)
const notice = ref<{ tone: 'error' | 'info'; text: string } | null>(null)
const institution = ref<string | null>(null)
const current = ref<Connection | null>(null)
const selected = ref<string[]>([])
const names = ref<Record<string, string>>({})
const removed = ref<'keep' | 'delete'>('keep')
const saving = ref(false)
const valid = ref(true)

/** Changing which accounts a connected bank imports, rather than connecting a new one. */
const choosing = computed(() => props.connection !== null)

/** "1 account" or "3 accounts". */
function accountCount(count: number): string {
  return count === 1 ? '1 account' : `${count} accounts`
}
const busy = computed(() => ['opening', 'saving', 'importing'].includes(step.value) || saving.value)
/** Plaid Link covers the page while it's open, so the dialog steps aside for it. */
const shown = computed({
  get: () => open.value && step.value !== 'linking',
  set: (value) => {
    open.value = value
  },
})

const sandbox = computed(() => health.system?.plaid.environment === 'sandbox')
const bankName = computed(() => current.value?.institution_name ?? institution.value ?? 'your bank')
const sync = computed(() => preferences.saved?.sync)

const steps = ['Sign in', 'Choose accounts', 'Import'] as const
const stepIndex = computed(() => {
  if (['start', 'opening', 'linking', 'saving'].includes(step.value)) return 0
  return step.value === 'accounts' ? 1 : 2
})

const imported = computed(() =>
  (current.value as Connection).accounts.filter((account) => account.state === 'imported'),
)
/** Imported accounts that were unticked, which stay as manual accounts or are deleted. */
const dropped = computed(() =>
  imported.value.filter((account) => !selected.value.includes(account.id)),
)

const droppedText = computed(() =>
  dropped.value.length === 1
    ? 'You’ve unticked an imported account. Its transactions:'
    : `You’ve unticked ${dropped.value.length} imported accounts. Their transactions:`,
)

const heading = computed((): { title: string; subtitle?: string; icon: LucideIcon } => {
  const bank = bankName.value
  const count = current.value?.accounts.length ?? 0
  switch (step.value) {
    case 'accounts':
      return choosing.value
        ? {
            title: `Choose accounts from ${bank}`,
            subtitle: 'Imported accounts stay up to date. The rest are left out.',
            icon: ListChecks,
          }
        : {
            title: 'Choose accounts to import',
            subtitle: `${bank} shares ${accountCount(count)}. Tick the ones Cashcove should keep up to date.`,
            icon: ListChecks,
          }
    case 'importing':
      return { title: `Importing from ${bank}`, icon: RefreshCw }
    case 'done':
      return { title: `${bank} is connected`, icon: CircleCheck }
    case 'saving':
      return { title: `Connecting ${bank}`, icon: Plug }
    default:
      return {
        title: 'Connect a bank',
        subtitle: 'Sign in to your bank through Plaid, then choose which accounts to import.',
        icon: Plug,
      }
  }
})

const promises = computed(() => [
  {
    icon: ShieldCheck,
    title: 'Sign in securely through Plaid',
    text: 'Plaid handles signing in to your bank. Cashcove never sees your password.',
  },
  {
    icon: ListChecks,
    title: 'Choose what to import',
    text: 'Pick which accounts Cashcove keeps up to date. You can change it later.',
  },
  {
    icon: RefreshCw,
    title: 'Stays up to date',
    text:
      sync.value && !sync.value.auto_sync
        ? 'Sync from the Connect tab whenever you want the latest.'
        : `New transactions and balances sync ${intervalLabel(sync.value?.interval_hours ?? 6).toLowerCase()}.`,
  },
])

function pick(from: Connection) {
  current.value = from
  const already = from.accounts.filter((account) => account.state === 'imported')
  selected.value = (choosing.value ? already : from.accounts).map((account) => account.id)
  names.value = Object.fromEntries(
    from.accounts.map((account) => [
      account.id,
      accounts.find(account.account_id)?.name ?? account.name,
    ]),
  )
  removed.value = 'keep'
  notice.value = null
}

async function link(resume?: { token: string; redirectUri: string }) {
  notice.value = null
  step.value = 'opening'
  try {
    const token = resume?.token ?? (await createLinkToken(historyDays.value)).link_token
    await loadLink()
    rememberLink({ token, purpose: 'connect', connectionId: null, historyDays: historyDays.value })
    step.value = 'linking'
    const outcome = await openLink(token, resume?.redirectUri)
    forgetLink()
    if (!outcome.connected) {
      step.value = 'start'
      notice.value = outcome.error
        ? { tone: 'error', text: linkErrorMessage(outcome.error) }
        : {
            tone: 'info',
            text: 'Plaid closed before a bank was connected. Continue when you’re ready.',
          }
      return
    }
    institution.value = outcome.institution
    step.value = 'saving'
    const saved = await createConnection(outcome.publicToken)
    store.put(saved)
    pick(saved)
    step.value = 'accounts'
  } catch (error) {
    forgetLink()
    step.value = 'start'
    notice.value = isCancelled(error) ? null : { tone: 'error', text: errorMessage(error) }
  }
}

async function save() {
  const target = current.value as Connection
  saving.value = true
  notice.value = null
  if (!choosing.value) step.value = 'importing'
  try {
    const updated = await chooseAccounts(target.id, {
      accounts: selected.value.map((id) => ({ id, name: names.value[id]?.trim() })),
      removed: removed.value,
    })
    store.put(updated)
    current.value = updated
    if (choosing.value) {
      notify(`Saved ${target.institution_name}’s accounts`)
      open.value = false
    } else {
      step.value = 'done'
    }
  } catch (error) {
    step.value = 'accounts'
    notice.value = isCancelled(error) ? null : { tone: 'error', text: errorMessage(error) }
  } finally {
    saving.value = false
  }
}

/** Enter saves too, once there's something to import. */
function submit() {
  if (selected.value.length && valid.value) void save()
}

function seeTransactions() {
  open.value = false
  void router.push('/transactions')
}

watch(
  open,
  (value) => {
    if (!value) return
    notice.value = null
    institution.value = null
    current.value = null
    void accounts.ensureLoaded()
    if (!preferences.saved && !preferences.loading) void preferences.load()
    historyDays.value = props.resume?.historyDays ?? preferences.saved?.sync.history_days ?? 730
    if (props.connection) {
      pick(props.connection)
      step.value = 'accounts'
    } else if (props.resume) {
      void link(props.resume)
    } else {
      step.value = 'start'
    }
  },
  { immediate: true },
)

/** Why the first sync went wrong, when it did: better told than "Imported 0 transactions". */
const problem = computed(() => {
  const target = current.value as Connection
  return target.status === 'healthy' ? null : target.error_message
})

const historyTone = computed(() => {
  if (problem.value) return 'warning'
  return (current.value as Connection).history === 'complete' ? 'success' : 'info'
})

/** What a newly connected bank's history looks like so far. */
const historyNote = computed(() => {
  if (problem.value) return problem.value
  const target = current.value as Connection
  const added = target.last_sync?.added ?? 0
  if (target.history === 'pending')
    return 'Plaid is still fetching transactions from the bank. They’ll show up on the Transactions page over the next few minutes, and your budget counts them as they arrive.'
  const count = added === 1 ? '1 transaction' : `${added} transactions`
  if (target.history === 'recent')
    return `Imported ${count} from the last month or so. Older ones are still on their way and will show up over the next few minutes.`
  return `Imported ${count}.`
})

function owed(type: Connection['accounts'][number]['type'], balance: string) {
  return accountType(type).liability ? negate(balance) : balance
}
</script>

<template>
  <AppDialog
    v-model="shown"
    :title="heading.title"
    :subtitle="heading.subtitle"
    :icon="heading.icon"
    :tone="step === 'done' ? 'success' : 'primary'"
    :persistent="busy"
    max-width="620"
    fullscreen-on-mobile
  >
    <StepList
      v-if="!choosing"
      :steps="steps"
      :current="stepIndex"
      :done="step === 'done'"
      class="mb-5"
    />

    <v-alert
      v-if="notice"
      :type="notice.tone"
      variant="tonal"
      density="compact"
      class="mb-5"
      :text="notice.text"
      data-test="connect-notice"
    />

    <div v-if="step === 'start'" data-test="connect-start">
      <div v-for="promise in promises" :key="promise.title" class="d-flex align-start ga-4 mb-4">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="40">
          <v-icon :icon="promise.icon" size="20" />
        </v-avatar>
        <div>
          <div class="text-title-small font-weight-bold">{{ promise.title }}</div>
          <div class="text-body-medium text-medium-emphasis">{{ promise.text }}</div>
        </div>
      </div>
      <v-select
        v-model="historyDays"
        :items="historyOptions"
        label="Import transactions from"
        hint="Some banks share less history than this."
        persistent-hint
        class="mt-6"
        data-test="connect-history"
      />
      <v-alert
        v-if="sandbox"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-5"
        data-test="connect-sandbox"
      >
        Cashcove is using Plaid’s sandbox, which has test banks only. Pick any bank and sign in with
        <strong>user_good</strong> and <strong>pass_good</strong>.
      </v-alert>
    </div>

    <div
      v-else-if="step === 'opening' || step === 'saving' || step === 'importing'"
      class="text-center py-10"
      data-test="connect-progress"
    >
      <v-progress-circular indeterminate color="primary" size="48" width="4" />
      <output class="d-block text-body-large mt-5">
        <template v-if="step === 'opening'">Opening Plaid…</template>
        <template v-else-if="step === 'saving'">Saving the connection to {{ bankName }}…</template>
        <template v-else>
          Importing {{ accountCount(selected.length) }} and their transactions…
        </template>
      </output>
    </div>

    <v-form
      v-else-if="step === 'accounts' && current"
      v-model="valid"
      data-test="connect-accounts"
      @submit.prevent="submit"
    >
      <AccountPicker
        v-model:selected="selected"
        v-model:names="names"
        :accounts="current.accounts"
        :show-new="choosing"
        :disabled="saving"
      />
      <v-expand-transition>
        <div v-if="choosing && dropped.length" class="mt-4" data-test="connect-removed">
          <p class="text-body-medium mb-2">{{ droppedText }}</p>
          <v-radio-group v-model="removed" hide-details density="compact" :disabled="saving">
            <v-radio
              value="keep"
              label="Keep them, in accounts you update by hand"
              data-test="connect-removed-keep"
            />
            <v-radio
              value="delete"
              label="Delete them for good"
              color="error"
              data-test="connect-removed-delete"
            />
          </v-radio-group>
        </div>
      </v-expand-transition>
    </v-form>

    <div v-else-if="step === 'done' && current" data-test="connect-done">
      <div class="d-flex align-center ga-4 mb-5">
        <BankLogo :connection="current" :size="56" />
        <div>
          <div class="text-title-medium font-weight-bold">{{ current.institution_name }}</div>
          <div class="text-body-medium text-medium-emphasis">
            {{ accountCount(imported.length) }} imported
          </div>
        </div>
      </div>
      <div
        v-for="account in imported"
        :key="account.id"
        class="connect-done__account d-flex align-center justify-space-between ga-3 py-2"
      >
        <span class="text-body-large text-break">{{ names[account.id] }}</span>
        <MoneyAmount
          :amount="owed(account.type, account.balance)"
          :currency="account.currency"
          class="font-weight-bold"
        />
      </div>
      <v-alert
        :type="historyTone"
        variant="tonal"
        density="compact"
        class="mt-5"
        data-test="connect-history-note"
      >
        {{ historyNote }}
      </v-alert>
    </div>

    <template #actions>
      <template v-if="step === 'start'">
        <v-btn variant="text" data-test="connect-cancel" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :append-icon="ArrowRight"
          data-test="connect-continue"
          @click="link()"
        >
          Continue to Plaid
        </v-btn>
      </template>
      <template v-else-if="step === 'accounts'">
        <v-btn variant="text" :disabled="saving" data-test="connect-later" @click="open = false">
          {{ choosing ? 'Cancel' : 'Not now' }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="!selected.length || !valid"
          data-test="connect-import"
          @click="save"
        >
          <template v-if="choosing">Save</template>
          <template v-else> Import {{ accountCount(selected.length) }} </template>
        </v-btn>
      </template>
      <template v-else-if="step === 'done'">
        <v-btn variant="text" data-test="connect-transactions" @click="seeTransactions">
          See transactions
        </v-btn>
        <v-btn color="primary" variant="flat" data-test="connect-finish" @click="open = false">
          Done
        </v-btn>
      </template>
    </template>
  </AppDialog>
</template>

<style scoped>
.connect-done__account + .connect-done__account {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
