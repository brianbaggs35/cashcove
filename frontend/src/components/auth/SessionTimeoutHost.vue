<script setup lang="ts">
import { TimerReset } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppDialog from '@/components/ui/AppDialog.vue'
import { useCountdown } from '@/composables/useCountdown'
import { useAuthStore } from '@/stores/auth'
import { formatCountdown } from '@/utils/format'

// Signs people out when the server's session runs out, warning them two minutes before.
// While someone is using Cashcove, the session is kept alive in the background, so the warning
// only appears when they've stepped away. Mounted in App.vue while someone is signed in.

const WARN_BEFORE = 2 * 60_000
// The server only records activity once a minute, so its clock may be up to a minute behind.
const SERVER_SLACK = 60_000
// How often an active person's session is renewed.
const KEEP_ALIVE_EVERY = 5 * 60_000
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

const auth = useAuthStore()
const now = ref(Date.now())
const staying = ref(false)

/** When the server will end the session: after idling, or at its fixed end, whichever is first. */
const deadline = computed<number | null>(() => {
  const session = auth.session
  if (!session) return null
  const idle = auth.lastActivity + session.idle_timeout_seconds * 1000 - SERVER_SLACK
  return Math.min(idle, new Date(session.expires_at).getTime())
})

const warning = computed(() => deadline.value !== null && deadline.value - now.value <= WARN_BEFORE)
const { remaining } = useCountdown(computed(() => (warning.value ? deadline.value : null)))
/** Staying can't help when the session has reached the end of its fixed lifetime. */
const endsForGood = computed(
  () => auth.session !== null && deadline.value === new Date(auth.session.expires_at).getTime(),
)

async function renew() {
  try {
    await auth.load()
  } catch {
    // Offline for a moment; the next check tries again.
  }
}

async function stay() {
  staying.value = true
  await renew()
  staying.value = false
  now.value = Date.now()
}

function onActivity() {
  if (document.visibilityState !== 'visible') return
  if (Date.now() - auth.lastActivity > KEEP_ALIVE_EVERY && !warning.value) void renew()
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 15_000)
  for (const event of ACTIVITY) window.addEventListener(event, onActivity, { passive: true })
})
onBeforeUnmount(() => {
  clearInterval(timer)
  for (const event of ACTIVITY) window.removeEventListener(event, onActivity)
})

const pastDeadline = () => deadline.value !== null && deadline.value <= Date.now()

// Time's up: ask the server, which answers that nobody is signed in if the session has ended.
// A countdown that stops because the person signed out has nothing to ask.
watch(remaining, async (seconds, before) => {
  if (seconds > 0 || before === 0 || deadline.value === null) return
  await renew()
  // Still past the deadline means the check itself failed; the session is over either way.
  if (auth.signedIn && pastDeadline()) auth.forget('expired')
})
</script>

<template>
  <AppDialog
    :model-value="warning && remaining > 0"
    :title="endsForGood ? 'Your session is ending' : 'Are you still there?'"
    :icon="TimerReset"
    tone="warning"
    :closable="false"
    persistent
    max-width="440"
  >
    <p class="text-body-medium mb-0" data-test="session-timeout-text">
      <template v-if="endsForGood">
        For your security, sessions last a limited time. You'll be signed out in
        <strong class="tabular-nums">{{ formatCountdown(remaining) }}</strong
        >. Save anything you're working on, then sign in again.
      </template>
      <template v-else>
        For your security, Cashcove signs you out after a while without activity. You'll be signed
        out in <strong class="tabular-nums">{{ formatCountdown(remaining) }}</strong
        >.
      </template>
    </p>
    <template #actions>
      <v-btn variant="text" data-test="session-sign-out" @click="auth.signOut()">
        Sign out now
      </v-btn>
      <v-btn
        v-if="!endsForGood"
        color="primary"
        variant="flat"
        :loading="staying"
        data-test="session-stay"
        @click="stay"
      >
        Stay signed in
      </v-btn>
    </template>
  </AppDialog>
</template>
