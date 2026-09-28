<script setup lang="ts">
import {
  Check,
  EllipsisVertical,
  ExternalLink,
  History,
  KeyRound,
  ListChecks,
  RefreshCw,
  Sparkles,
  Trash2,
  type LucideIcon,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import type { Connection, ConnectionSync, SharedAccount } from '@/api/connections'
import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import { accountType } from '@/components/finance/accountTypes'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { formatShortDate } from '@/utils/format'
import { negate } from '@/utils/money'
import { relink, syncChanges, syncNow } from '@/views/connect/actions'
import BankLogo from '@/views/connect/BankLogo.vue'

/** One connected bank: how its syncing is going, its accounts, and what admins can do with it. */
const props = defineProps<{ connection: Connection }>()
const emit = defineEmits<{
  choose: [connection: Connection]
  history: [connection: Connection]
  remove: [connection: Connection]
}>()

const auth = useAuthStore()
const accounts = useAccountsStore()
const { xs } = useDisplay()

/** What the card is busy doing for the person, which disables everything else on it. */
const busy = ref<'sync' | 'reconnect' | 'accounts' | null>(null)
const syncing = computed(() => props.connection.syncing || busy.value === 'sync')
const bank = computed(() => props.connection.institution_name)

const CONSENT_WARNING_DAYS = 30

interface Status {
  text: string
  color: string
  icon?: LucideIcon
  /** Something is under way, like a sync. */
  spinning?: boolean
}

const status = computed((): Status => {
  const { connection } = props
  if (syncing.value) return { text: 'Syncing', color: 'info', spinning: true }
  if (connection.status === 'login_required')
    return { text: 'Sign-in needed', color: 'warning', icon: KeyRound }
  if (connection.status === 'error') return { text: 'Sync failed', color: 'error' }
  if (connection.history !== 'complete')
    return { text: 'Importing history', color: 'info', spinning: true }
  return { text: 'Up to date', color: 'success', icon: Check }
})

const imported = computed(() =>
  props.connection.accounts.filter((account) => account.state === 'imported'),
)
const unchosen = computed(() =>
  props.connection.accounts.filter((account) => account.state === 'new'),
)

/** When the bank stops sharing unless someone renews consent, if that's soon. */
const consentEnds = computed(() => {
  const ends = props.connection.consent_expires_at
  if (!ends) return null
  const days = (new Date(ends).getTime() - Date.now()) / 86_400_000
  return days <= CONSENT_WARNING_DAYS ? formatShortDate(new Date(ends)) : null
})

/** What a sync did, in a few words. */
function outcome(sync: ConnectionSync): string {
  if (!sync.succeeded) return 'failed'
  return syncChanges(sync) ?? 'nothing new'
}

function name(account: SharedAccount): string {
  return accounts.find(account.account_id)?.name ?? account.name
}

function details(account: SharedAccount): string {
  return [account.mask && `•••• ${account.mask}`, accountType(account.type).title]
    .filter(Boolean)
    .join(' · ')
}

function balance(account: SharedAccount) {
  return accountType(account.type).liability
    ? { amount: negate(account.balance), caption: 'owed' }
    : { amount: account.balance, caption: null }
}

const states: Record<SharedAccount['state'], { text: string; color?: string }> = {
  imported: { text: 'Imported', color: 'success' },
  skipped: { text: 'Not imported' },
  new: { text: 'New', color: 'accent' },
}

async function run(what: NonNullable<typeof busy.value>, action: () => Promise<unknown>) {
  busy.value = what
  try {
    await action()
  } finally {
    busy.value = null
  }
}

/** A menu of actions can't hold links, so the bank's website opens from a click. */
function openWebsite(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

const sync = () => run('sync', () => syncNow(props.connection))
const reconnect = () => run('reconnect', () => relink(props.connection, 'reconnect'))
/** Lets the bank share different accounts, then offers to import any new ones. */
const shareOthers = () =>
  run('accounts', async () => {
    const updated = await relink(props.connection, 'accounts')
    if (updated) emit('choose', updated)
  })
</script>

<template>
  <v-card class="connection mb-4" data-test="connection-card">
    <div class="d-flex align-start ga-4 pa-5 pb-3">
      <BankLogo :connection="connection" :size="xs ? 44 : 52" />
      <div class="flex-grow-1" style="min-width: 0">
        <div class="d-flex align-center flex-wrap ga-2">
          <h2
            class="text-title-medium font-weight-bold text-break ma-0"
            data-test="connection-name"
          >
            {{ bank }}
          </h2>
          <v-chip
            size="small"
            :color="status.color"
            variant="tonal"
            :prepend-icon="status.icon"
            data-test="connection-status"
          >
            <v-progress-circular
              v-if="status.spinning"
              indeterminate
              size="12"
              width="2"
              class="me-2"
              aria-hidden="true"
            />
            {{ status.text }}
          </v-chip>
        </div>
        <div
          class="connection__meta text-body-small text-medium-emphasis mt-1"
          data-test="connection-meta"
        >
          <span>Connected {{ formatShortDate(new Date(connection.created_at)) }}</span>
          <span v-if="connection.last_synced_at">
            Synced <RelativeTime :value="connection.last_synced_at" />
          </span>
          <span v-else>Not synced yet</span>
          <span v-if="connection.next_sync_at" data-test="connection-next">
            Next sync <RelativeTime :value="connection.next_sync_at" />
          </span>
          <span v-else-if="connection.status === 'login_required'" data-test="connection-next">
            Paused until you reconnect
          </span>
        </div>
      </div>
      <div class="d-flex align-center ga-1 flex-shrink-0">
        <v-btn
          v-if="auth.isAdmin && connection.status !== 'login_required'"
          :variant="xs ? 'text' : 'tonal'"
          color="primary"
          :icon="xs ? RefreshCw : undefined"
          :prepend-icon="xs ? undefined : RefreshCw"
          :loading="syncing"
          :disabled="!!busy"
          :aria-label="xs ? `Sync ${bank} now` : undefined"
          :size="xs ? 'small' : 'default'"
          data-test="connection-sync"
          @click="sync"
        >
          <!-- On a phone it's the icon alone: a default slot, even an empty one, would hide it. -->
          <template v-if="!xs" #default>Sync now</template>
        </v-btn>
        <v-menu location="bottom end">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              :icon="EllipsisVertical"
              variant="text"
              size="small"
              :aria-label="`Actions for ${bank}`"
              data-test="connection-actions"
            />
          </template>
          <v-list density="compact" nav min-width="240">
            <template v-if="auth.isAdmin">
              <v-list-item
                :prepend-icon="ListChecks"
                title="Choose accounts"
                :disabled="!!busy"
                data-test="connection-choose"
                @click="emit('choose', connection)"
              />
              <v-list-item
                :prepend-icon="KeyRound"
                title="Reconnect"
                subtitle="Sign in to the bank again"
                :disabled="!!busy"
                data-test="connection-reconnect"
                @click="reconnect"
              />
              <v-list-item
                :prepend-icon="Sparkles"
                title="Share other accounts"
                subtitle="Change what the bank shares"
                :disabled="!!busy"
                data-test="connection-share"
                @click="shareOthers"
              />
            </template>
            <v-list-item
              :prepend-icon="History"
              title="Sync history"
              data-test="connection-history"
              @click="emit('history', connection)"
            />
            <v-list-item
              v-if="connection.institution_url"
              :prepend-icon="ExternalLink"
              :title="`Open ${bank}’s website`"
              data-test="connection-website"
              @click="openWebsite(connection.institution_url)"
            />
            <template v-if="auth.isAdmin">
              <v-divider class="my-1" aria-hidden="true" />
              <v-list-item
                :prepend-icon="Trash2"
                title="Remove"
                base-color="error"
                :disabled="!!busy"
                data-test="connection-remove"
                @click="emit('remove', connection)"
              />
            </template>
          </v-list>
        </v-menu>
      </div>
    </div>

    <div class="px-5">
      <v-alert
        v-if="connection.status === 'login_required'"
        type="warning"
        variant="tonal"
        density="compact"
        class="connection__alert mb-3"
        data-test="connection-problem"
      >
        {{ connection.error_message ?? `${bank} needs you to sign in again.` }}
        <template v-if="auth.isAdmin" #append>
          <v-btn
            variant="flat"
            color="warning"
            size="small"
            :loading="busy === 'reconnect'"
            :disabled="!!busy"
            data-test="connection-problem-reconnect"
            @click="reconnect"
          >
            Reconnect
          </v-btn>
        </template>
      </v-alert>
      <v-alert
        v-else-if="connection.status === 'error'"
        type="error"
        variant="tonal"
        density="compact"
        class="connection__alert mb-3"
        data-test="connection-problem"
      >
        {{ connection.error_message ?? `The last sync of ${bank} failed.` }}
        <template v-if="auth.isAdmin" #append>
          <v-btn
            variant="text"
            size="small"
            :disabled="!!busy"
            data-test="connection-problem-retry"
            @click="sync"
          >
            Try again
          </v-btn>
        </template>
      </v-alert>

      <v-alert
        v-if="consentEnds && connection.status !== 'login_required'"
        type="warning"
        variant="tonal"
        density="compact"
        class="connection__alert mb-3"
        data-test="connection-consent"
      >
        {{ bank }} stops sharing on {{ consentEnds }} unless you renew your consent. Reconnect to
        renew it.
        <template v-if="auth.isAdmin" #append>
          <v-btn variant="text" size="small" :disabled="!!busy" @click="reconnect">Reconnect</v-btn>
        </template>
      </v-alert>

      <v-alert
        v-if="connection.history !== 'complete' && imported.length"
        type="info"
        variant="tonal"
        density="compact"
        class="connection__alert mb-3"
        data-test="connection-importing"
      >
        <template v-if="connection.history === 'pending'">
          Plaid is fetching transactions from {{ bank }}. It can take a few minutes; they show up on
          the Transactions page as they arrive.
        </template>
        <template v-else>
          The last month or so is in. Older transactions are still on their way.
        </template>
      </v-alert>

      <v-alert
        v-if="unchosen.length"
        :icon="Sparkles"
        color="accent"
        variant="tonal"
        density="compact"
        class="connection__alert mb-3"
        data-test="connection-unchosen"
      >
        <template v-if="imported.length">
          {{ bank }} shares
          {{ unchosen.length === 1 ? 'an account' : `${unchosen.length} accounts` }} you haven’t
          chosen whether to import yet.
        </template>
        <template v-else
          >Nothing is imported from {{ bank }} until its accounts are chosen.</template
        >
        <template v-if="auth.isAdmin" #append>
          <v-btn
            variant="text"
            size="small"
            :disabled="!!busy"
            data-test="connection-unchosen-choose"
            @click="emit('choose', connection)"
          >
            Choose accounts
          </v-btn>
        </template>
      </v-alert>
    </div>

    <div class="px-2 pb-2">
      <component
        :is="account.account_id ? 'router-link' : 'div'"
        v-for="account in connection.accounts"
        :key="account.id"
        :to="
          account.account_id
            ? { path: '/transactions', query: { account: account.account_id } }
            : undefined
        "
        class="connection__account d-flex align-center ga-4 py-3 px-3"
        :class="{ 'connection__account--muted': account.state !== 'imported' }"
        data-test="connection-account"
      >
        <AccountAvatar :type="account.type" size="40" />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="d-flex align-center flex-wrap ga-2">
            <span
              class="text-title-small font-weight-bold text-break"
              data-test="connection-account-name"
            >
              {{ name(account) }}
            </span>
            <v-chip
              size="x-small"
              :color="states[account.state].color"
              variant="tonal"
              data-test="connection-account-state"
            >
              {{ states[account.state].text }}
            </v-chip>
          </div>
          <div class="text-body-small text-medium-emphasis text-truncate">
            {{ details(account) }}
          </div>
        </div>
        <div class="text-end flex-shrink-0">
          <MoneyAmount
            :amount="balance(account).amount"
            :currency="account.currency"
            class="text-title-small font-weight-bold"
          />
          <div v-if="balance(account).caption" class="text-label-small text-medium-emphasis">
            {{ balance(account).caption }}
          </div>
        </div>
      </component>
    </div>

    <div
      v-if="connection.last_sync"
      class="connection__footer d-flex align-center flex-wrap ga-2 px-5 py-2"
    >
      <span class="text-body-small text-medium-emphasis" data-test="connection-last-sync">
        Last sync <RelativeTime :value="connection.last_sync.finished_at" />:
        <span :class="{ 'text-error': !connection.last_sync.succeeded }">{{
          outcome(connection.last_sync)
        }}</span>
      </span>
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        :prepend-icon="History"
        data-test="connection-history-link"
        @click="emit('history', connection)"
      >
        Sync history
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.connection__meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: 6px;
}

.connection__meta > span + span::before {
  content: '·';
  margin-inline-end: 6px;
}

/* Phones: one fact per line, and alerts' buttons under their text. */
@media (max-width: 599.98px) {
  .connection__meta {
    flex-direction: column;
  }

  .connection__meta > span + span::before {
    content: none;
  }

  .connection__alert {
    grid-template-areas: 'prepend content' 'prepend append';
    grid-template-columns: max-content auto;
  }

  .connection__alert :deep(.v-alert__append) {
    margin-top: 8px;
    margin-inline-start: 0;
  }
}

.connection__account {
  border-radius: 14px;
  color: inherit;
  text-decoration: none;
  transition: background-color 0.15s;
}

a.connection__account:hover,
a.connection__account:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

a.connection__account:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.connection__account--muted :deep(.v-avatar) {
  filter: grayscale(1);
  opacity: 0.7;
}

.connection__footer {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
