<script setup lang="ts">
import { CloudOff, RefreshCw } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'vuetify'

import { connectApi } from '@/auth/connect'
import SessionTimeoutHost from '@/components/auth/SessionTimeoutHost.vue'
import VerifyIdentityHost from '@/components/auth/VerifyIdentityHost.vue'
import ConfirmDialogHost from '@/components/ui/ConfirmDialogHost.vue'
import NotificationHost from '@/components/ui/NotificationHost.vue'
import AppShell from '@/layouts/AppShell.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const route = useRoute()
const router = useRouter()
const theme = useTheme()
const themeStore = useThemeStore()
const auth = useAuthStore()
const ready = ref(false)
const retrying = ref(false)

connectApi()
void router.isReady().then(() => (ready.value = true))

watch(
  () => themeStore.preference,
  (preference) => theme.change(preference),
  { immediate: true },
)

// Whenever someone stops being signed in (signing out, or the session ending), go to sign-in,
// coming back to the same page afterwards if the session simply ran out. Pages anyone can open,
// like an invitation, stay put.
watch(
  () => auth.signedIn,
  (signedIn, wasSignedIn) => {
    if (signedIn || !wasSignedIn || route.meta.access === 'public') return
    auth.signedOutReason ??= 'expired'
    const redirect = auth.signedOutReason === 'expired' ? route.fullPath : undefined
    void router.push({ name: 'sign-in', query: redirect ? { redirect } : {} })
  },
)

async function retry() {
  retrying.value = true
  try {
    await auth.load()
    await router.replace({ path: route.fullPath, force: true })
  } catch {
    // Still unreachable; the message stays up.
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <v-app>
    <div
      v-if="auth.loadError && !auth.state"
      class="startup-error d-flex align-center justify-center pa-6"
      data-test="startup-error"
    >
      <v-empty-state
        :icon="CloudOff"
        headline="Can't reach Cashcove"
        :text="`${auth.loadError} If it keeps happening, check that the Cashcove container is running.`"
      >
        <template #actions>
          <v-btn
            color="primary"
            variant="flat"
            :prepend-icon="RefreshCw"
            :loading="retrying"
            data-test="startup-retry"
            @click="retry"
          >
            Try again
          </v-btn>
        </template>
      </v-empty-state>
    </div>
    <template v-else-if="ready">
      <router-view v-if="route.meta.bare" />
      <AppShell v-else />
      <SessionTimeoutHost v-if="auth.signedIn" />
    </template>
    <div v-else class="app-loading" aria-busy="true" data-test="app-loading">
      <v-progress-circular indeterminate color="primary" size="36" width="3" />
    </div>

    <ConfirmDialogHost />
    <VerifyIdentityHost />
    <NotificationHost />
  </v-app>
</template>

<style scoped>
.startup-error {
  min-height: 100dvh;
}

.app-loading {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  /* Only shows up if loading takes a moment, so fast loads don't flash a spinner. */
  animation: appear 0.2s 0.3s both;
}

@keyframes appear {
  from {
    opacity: 0;
  }
}
</style>
