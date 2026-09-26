<script setup lang="ts">
import { Fingerprint, KeyRound, ShieldCheck, Smartphone } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import {
  verifyWithPasskey,
  verifyWithPasskeyOptions,
  verifyWithPassword,
  verifyWithTotp,
} from '@/api/account'
import { answerWithPasskey } from '@/auth/passkeyFlows'
import AppDialog from '@/components/ui/AppDialog.vue'
import CodeInput from '@/components/ui/CodeInput.vue'
import PasswordField from '@/components/ui/PasswordField.vue'
import { useAction } from '@/composables/useAction'
import { verificationRequest as request } from '@/composables/verification'
import { useAuthStore } from '@/stores/auth'

// The "Confirm it's you" prompt the API asks for before sensitive changes. Mounted once, in
// App.vue; the API client opens it and retries the change once it succeeds.
const auth = useAuthStore()
const open = ref(false)
const method = ref<'password' | 'totp'>('password')
const password = ref('')
const code = ref('')
const running = ref<'password' | 'totp' | 'passkey' | null>(null)

const hasPasskeys = computed(() => auth.passkeysAvailable && Boolean(auth.user?.passkey_count))
const hasTotp = computed(() => auth.user?.totp_enabled === true)

const { busy, error, run } = useAction(async (how: 'password' | 'totp' | 'passkey') => {
  if (how === 'password') await verifyWithPassword(password.value)
  else if (how === 'totp') await verifyWithTotp(code.value)
  else if ((await answerWithPasskey(verifyWithPasskeyOptions, verifyWithPasskey)) === null) {
    return false
  }
  return true
})

watch(
  request,
  (value) => {
    open.value = value !== null
    if (value) {
      method.value = 'password'
      password.value = ''
      code.value = ''
      error.value = null
    }
  },
  { immediate: true },
)

async function confirmWith(how: 'password' | 'totp' | 'passkey') {
  running.value = how
  if (await run(how)) request.value?.resolve(true)
  else if (how === 'totp') code.value = ''
}

function submit() {
  if (method.value === 'password' && password.value) void confirmWith('password')
  if (method.value === 'totp' && code.value.length === 6) void confirmWith('totp')
}
</script>

<template>
  <AppDialog
    :model-value="open"
    title="Confirm it's you"
    subtitle="Cashcove asks again before sensitive changes, in case someone else is at your device."
    :icon="ShieldCheck"
    :persistent="busy"
    max-width="460"
    @update:model-value="(value) => value || request?.resolve(false)"
  >
    <v-btn
      v-if="hasPasskeys"
      block
      size="large"
      color="primary"
      variant="flat"
      :prepend-icon="Fingerprint"
      :loading="busy && running === 'passkey'"
      :disabled="busy && running !== 'passkey'"
      class="mb-2"
      data-test="verify-passkey"
      @click="confirmWith('passkey')"
    >
      Use your passkey
    </v-btn>
    <div v-if="hasPasskeys" class="verify__divider text-label-medium text-medium-emphasis my-4">
      or
    </div>

    <v-form @submit.prevent="submit">
      <PasswordField
        v-if="method === 'password'"
        v-model="password"
        label="Your password"
        :autofocus="!hasPasskeys"
        test-id="verify-password"
      />
      <div v-else>
        <p class="text-body-medium mb-3">Enter the code from your authenticator app.</p>
        <CodeInput v-model="code" :disabled="busy" @complete="confirmWith('totp')" />
      </div>
      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="error"
        data-test="verify-error"
      />
      <v-btn
        v-if="hasTotp"
        variant="text"
        size="small"
        class="mt-3 px-2"
        :prepend-icon="method === 'password' ? Smartphone : KeyRound"
        data-test="verify-switch"
        @click="method = method === 'password' ? 'totp' : 'password'"
      >
        {{
          method === 'password' ? 'Use an authenticator code instead' : 'Use your password instead'
        }}
      </v-btn>
      <!-- Lets Enter submit the form. -->
      <button type="submit" hidden />
    </v-form>

    <template #actions>
      <v-btn
        variant="text"
        :disabled="busy"
        data-test="verify-cancel"
        @click="request?.resolve(false)"
      >
        Cancel
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="busy && running !== 'passkey'"
        :disabled="method === 'password' ? !password : code.length < 6"
        data-test="verify-confirm"
        @click="submit"
      >
        Confirm
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.verify__divider {
  display: flex;
  align-items: center;
  gap: 12px;
}

.verify__divider::before,
.verify__divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
