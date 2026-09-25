<script setup lang="ts">
import { LifeBuoy, ShieldCheck, ShieldOff, Smartphone, TriangleAlert } from '@lucide/vue'
import { computed, ref } from 'vue'

import { createRecoveryCodes, turnOffTotp } from '@/api/account'
import type { User } from '@/api/auth'
import AuthenticatorSetup from '@/components/auth/AuthenticatorSetup.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import RecoveryCodes from '@/components/ui/RecoveryCodes.vue'
import { confirm, confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import SettingsCard from '@/views/settings/SettingsCard.vue'

/** Two-step verification with an authenticator app, and the recovery codes that come with it. */
const props = defineProps<{ user: User }>()
const emit = defineEmits<{ changed: [] }>()

const RUNNING_LOW = 3

const auth = useAuthStore()
const setupOpen = ref(false)
const codes = ref<string[]>([])
const codesOpen = ref(false)
const saved = ref(false)

const codesLeft = computed(() => props.user.recovery_codes_left)

function setupFinished() {
  setupOpen.value = false
  notify('Two-step verification is on')
  emit('changed')
}

async function turnOff() {
  const off = await confirm({
    title: 'Turn off two-step verification?',
    text: 'Signing in with your password will no longer ask for a code, and your recovery codes will stop working.',
    confirmText: 'Turn off',
    tone: 'error',
    icon: ShieldOff,
    action: turnOffTotp,
  })
  if (!off) return
  auth.updateUser({ totp_enabled: false, recovery_codes_left: 0 })
  notify('Two-step verification is off', 'info')
  emit('changed')
}

async function replaceCodes() {
  const created = await confirmAndRun(
    {
      title: 'Create new recovery codes?',
      text: 'Your current recovery codes will stop working straight away.',
      confirmText: 'Create new codes',
      tone: 'warning',
      icon: LifeBuoy,
    },
    createRecoveryCodes,
  )
  if (!created) return
  codes.value = created.result.codes
  saved.value = false
  codesOpen.value = true
  auth.updateUser({ recovery_codes_left: codes.value.length })
  emit('changed')
}
</script>

<template>
  <SettingsCard
    id="two-step"
    title="Two-step verification"
    subtitle="After your password, Cashcove asks for a 6-digit code from an authenticator app on your phone."
    :icon="Smartphone"
  >
    <template #append>
      <v-chip
        :color="user.totp_enabled ? 'success' : undefined"
        :prepend-icon="user.totp_enabled ? ShieldCheck : ShieldOff"
        size="small"
        variant="tonal"
        data-test="two-step-status"
      >
        {{ user.totp_enabled ? 'On' : 'Off' }}
      </v-chip>
    </template>

    <template v-if="user.totp_enabled">
      <div class="two-step-codes d-flex flex-wrap align-center ga-4 pa-4">
        <v-avatar color="secondary" variant="tonal" rounded="lg" size="40">
          <v-icon :icon="LifeBuoy" size="20" />
        </v-avatar>
        <div class="flex-grow-1" style="min-width: 200px">
          <div class="text-title-small font-weight-bold" data-test="recovery-codes-left">
            {{ codesLeft === 1 ? '1 recovery code left' : `${codesLeft} recovery codes left` }}
          </div>
          <div class="text-body-small text-medium-emphasis">
            Each one signs you in once if you lose your phone.
          </div>
        </div>
        <v-btn variant="tonal" data-test="recovery-codes-new" @click="replaceCodes">
          Create new codes
        </v-btn>
      </div>
      <v-alert
        v-if="codesLeft <= RUNNING_LOW"
        type="warning"
        variant="tonal"
        density="compact"
        :icon="TriangleAlert"
        class="mt-4"
        data-test="recovery-codes-low"
      >
        You're running low on recovery codes. Create new ones and keep them somewhere safe.
      </v-alert>
      <div class="d-flex justify-end mt-4">
        <v-btn
          variant="text"
          color="error"
          :prepend-icon="ShieldOff"
          data-test="two-step-off"
          @click="turnOff"
        >
          Turn off
        </v-btn>
      </div>
    </template>

    <template v-else>
      <p class="text-body-medium mb-4">
        With it on, someone who learns your password still can't sign in without your phone. Passkey
        sign-ins don't need it: a passkey already proves both.
      </p>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Smartphone"
        data-test="two-step-setup"
        @click="setupOpen = true"
      >
        Set up an authenticator app
      </v-btn>
    </template>
  </SettingsCard>

  <AppDialog
    v-model="setupOpen"
    title="Set up an authenticator app"
    subtitle="It takes about a minute. Keep your phone handy."
    :icon="Smartphone"
    max-width="720"
    fullscreen-on-mobile
    :persistent="user.totp_enabled"
    :closable="!user.totp_enabled"
  >
    <AuthenticatorSetup v-if="setupOpen" @finished="setupFinished" @cancelled="setupOpen = false" />
  </AppDialog>

  <!-- Only Done closes it, once the codes are saved. -->
  <AppDialog
    :model-value="codesOpen"
    title="Your new recovery codes"
    subtitle="Your old codes no longer work. Keep these somewhere safe, like your password manager."
    :icon="LifeBuoy"
    :closable="false"
    persistent
    max-width="640"
  >
    <RecoveryCodes :codes="codes" :email="user.email" />
    <v-checkbox
      v-model="saved"
      label="I've saved my recovery codes"
      color="primary"
      hide-details
      class="mt-4"
      data-test="new-codes-saved"
    />
    <template #actions>
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!saved"
        data-test="new-codes-done"
        @click="codesOpen = false"
      >
        Done
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.two-step-codes {
  border-radius: 16px;
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
