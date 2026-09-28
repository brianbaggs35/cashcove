<script setup lang="ts">
import { Lock, Plug } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { Connection, HistoryDays } from '@/api/connections'
import TabPage from '@/components/TabPage.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { notify } from '@/composables/notify'
import { takePendingLink } from '@/plaid/link'
import { CONNECT_OAUTH } from '@/router'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useConnectionsStore } from '@/stores/connections'
import { useHealthStore } from '@/stores/health'
import { relink } from '@/views/connect/actions'
import ConnectDialog from '@/views/connect/ConnectDialog.vue'
import ConnectIntro from '@/views/connect/ConnectIntro.vue'
import ConnectionCard from '@/views/connect/ConnectionCard.vue'
import ConnectSummary from '@/views/connect/ConnectSummary.vue'
import PlaidSetupCard from '@/views/connect/PlaidSetupCard.vue'
import RemoveConnectionDialog from '@/views/connect/RemoveConnectionDialog.vue'
import SyncHistoryDialog from '@/views/connect/SyncHistoryDialog.vue'

const auth = useAuthStore()
const store = useConnectionsStore()
const health = useHealthStore()
const accounts = useAccountsStore()
const route = useRoute()
const router = useRouter()

const plaid = computed(() => health.system?.plaid)
/** Plaid's keys are missing; until the system info loads, assume they're there. */
const unconfigured = computed(() => plaid.value?.configured === false)
const canConnect = computed(() => auth.isAdmin && !unconfigured.value)

const connectOpen = ref(false)
const choosing = ref<Connection | null>(null)
const resume = ref<{ token: string; historyDays: HistoryDays | null; redirectUri: string } | null>(
  null,
)
const history = ref<Connection | null>(null)
const historyOpen = ref(false)
const removing = ref<Connection | null>(null)
const removeOpen = ref(false)

function connect() {
  choosing.value = null
  resume.value = null
  connectOpen.value = true
}

function choose(connection: Connection) {
  choosing.value = connection
  resume.value = null
  connectOpen.value = true
}

function showHistory(connection: Connection) {
  history.value = connection
  historyOpen.value = true
}

function remove(connection: Connection) {
  removing.value = connection
  removeOpen.value = true
}

/** Checks for what syncs changed while one is under way, as long as the tab is open. */
let timer: ReturnType<typeof setTimeout> | undefined
function poll() {
  clearTimeout(timer)
  const delay = store.pollDelay
  if (delay !== null) timer = setTimeout(() => void store.load().then(poll), delay)
}
watch(() => store.pollDelay, poll)

/**
 * A bank that signs people in on its own site sends them back to /connect/oauth, where Plaid
 * Link picks up where it left off.
 */
async function resumeLink() {
  const pending = takePendingLink()
  const redirectUri = window.location.href
  void router.replace('/connect')
  if (!pending) {
    notify('That bank sign-in has expired. Start connecting the bank again.', 'error')
    return
  }
  if (pending.purpose === 'connect') {
    choosing.value = null
    resume.value = { token: pending.token, historyDays: pending.historyDays, redirectUri }
    connectOpen.value = true
    return
  }
  await store.ensureLoaded()
  const connection = store.find(pending.connectionId)
  if (!connection) return
  const updated = await relink(connection, pending.purpose, { token: pending.token, redirectUri })
  if (updated && pending.purpose === 'accounts') choose(updated)
}

onMounted(() => {
  void store.load().then(poll)
  void accounts.ensureLoaded()
  if (!health.system) void health.refresh()
  if (route.path === CONNECT_OAUTH) void resumeLink()
})
onBeforeUnmount(() => {
  clearTimeout(timer)
})
</script>

<template>
  <TabPage name="connect">
    <template v-if="canConnect && store.connections.length" #actions>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Plug"
        data-test="connect-add"
        @click="connect"
      >
        Connect a bank
      </v-btn>
    </template>

    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      text="You can see every connected bank. Only an admin can connect, sync or remove them."
    />

    <PlaidSetupCard v-if="unconfigured" />

    <v-alert
      v-if="store.error && !store.loaded"
      type="error"
      variant="tonal"
      :text="`Couldn't load your connected banks. ${store.error}`"
      data-test="connections-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="connections-retry" @click="store.load()">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-else-if="!store.loaded" data-test="connections-loading">
      <v-skeleton-loader type="heading, text" class="mb-6 rounded-xl" />
      <v-skeleton-loader type="list-item-avatar-two-line@3" class="rounded-xl" />
    </div>

    <template v-else-if="store.connections.length">
      <ConnectSummary :connections="store.connections" />
      <ConnectionCard
        v-for="connection in store.connections"
        :key="connection.id"
        :connection="connection"
        @choose="choose"
        @history="showHistory"
        @remove="remove"
      />
      <div
        class="d-flex align-start ga-3 text-body-small text-medium-emphasis mt-6 px-2"
        data-test="connect-privacy"
      >
        <v-icon :icon="Lock" size="16" class="mt-1 flex-shrink-0" />
        <p class="mb-0">
          Banks connect through Plaid. Cashcove never sees your bank passwords, and keeps Plaid’s
          access to your banks encrypted on this server. Removing a bank also ends Plaid’s access to
          it.
        </p>
      </div>
    </template>

    <ConnectIntro
      v-else-if="!unconfigured"
      :can-connect="canConnect"
      :viewer="!auth.isAdmin"
      @connect="connect"
    />

    <template v-if="auth.isAdmin">
      <ConnectDialog v-model="connectOpen" :connection="choosing" :resume="resume" />
      <RemoveConnectionDialog v-model="removeOpen" :connection="removing" />
    </template>
    <SyncHistoryDialog v-model="historyOpen" :connection="history" />
  </TabPage>
</template>
