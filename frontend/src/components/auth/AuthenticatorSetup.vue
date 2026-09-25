<script setup lang="ts">
import { CircleCheckBig, ExternalLink, RefreshCw } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'

import { confirmTotpSetup, startTotpSetup, type TotpSetup } from '@/api/account'
import CodeInput from '@/components/ui/CodeInput.vue'
import CopyField from '@/components/ui/CopyField.vue'
import QrCode from '@/components/ui/QrCode.vue'
import RecoveryCodes from '@/components/ui/RecoveryCodes.vue'
import { useAction } from '@/composables/useAction'
import { useCountdown } from '@/composables/useCountdown'
import { useAuthStore } from '@/stores/auth'

/**
 * Turns on two-step verification: scan a QR code, confirm a code from the app, then keep the
 * recovery codes. Used by the first-run wizard and by Settings.
 */
withDefaults(defineProps<{ doneText?: string }>(), { doneText: 'Done' })
const emit = defineEmits<{ finished: []; cancelled: [] }>()

const auth = useAuthStore()
const { smAndDown } = useDisplay()
const setup = ref<TotpSetup | null>(null)
const code = ref('')
const codes = ref<string[]>([])
const saved = ref(false)
const showKey = ref(false)

const deadline = computed(() => (setup.value ? Date.parse(setup.value.expires_at) : null))
const { remaining } = useCountdown(deadline)
const expired = computed(() => setup.value !== null && remaining.value === 0)

/** The key in groups of four, which is easier to read and type. */
function grouped(key: string): string {
  return key.replace(/(.{4})(?=.)/g, '$1 ')
}

const starting = useAction(async () => {
  code.value = ''
  setup.value = await startTotpSetup()
})

const confirming = useAction(async () => {
  const result = await confirmTotpSetup(code.value)
  codes.value = result.codes
  auth.updateUser({ totp_enabled: true, recovery_codes_left: result.codes.length })
})

const error = computed(() => confirming.error.value ?? starting.error.value)

async function confirm() {
  await confirming.run()
  if (confirming.error.value) code.value = ''
}

onMounted(async () => {
  await starting.run()
  // Nothing came back and nothing failed: the person chose not to confirm it was them.
  if (!setup.value && !starting.error.value) emit('cancelled')
})
</script>

<template>
  <div v-if="codes.length" data-test="authenticator-codes">
    <div class="d-flex align-center ga-3 mb-4">
      <v-icon :icon="CircleCheckBig" color="success" size="28" />
      <div class="text-title-medium font-weight-bold">Two-step verification is on</div>
    </div>
    <p class="text-body-medium mb-4">
      If you ever lose your phone, these recovery codes get you back in. Each one works once. Keep
      them somewhere safe, like your password manager.
    </p>
    <RecoveryCodes :codes="codes" :email="auth.user?.email ?? ''" />
    <v-checkbox
      v-model="saved"
      label="I've saved my recovery codes"
      color="primary"
      hide-details
      class="mt-4"
      data-test="codes-saved"
    />
    <v-btn
      color="primary"
      variant="flat"
      size="large"
      class="mt-2"
      :disabled="!saved"
      data-test="authenticator-done"
      @click="emit('finished')"
    >
      {{ doneText }}
    </v-btn>
  </div>

  <div v-else class="authenticator-setup" data-test="authenticator-setup">
    <div class="authenticator-setup__qr">
      <QrCode
        v-if="setup && !expired"
        :value="setup.uri"
        :size="184"
        label="QR code for your authenticator app"
      />
      <v-skeleton-loader v-else-if="starting.busy.value" type="image" width="184" height="184" />
      <div
        v-else
        class="authenticator-setup__expired d-flex flex-column align-center justify-center pa-4 text-center"
      >
        <p class="text-body-small mb-3">
          {{ expired ? 'This QR code has expired.' : "Couldn't get a QR code." }}
        </p>
        <v-btn
          :prepend-icon="RefreshCw"
          variant="tonal"
          size="small"
          data-test="authenticator-restart"
          @click="starting.run()"
        >
          Get a new one
        </v-btn>
      </div>
    </div>

    <ol class="authenticator-setup__steps">
      <li>
        <div class="text-title-small font-weight-bold">Open your authenticator app</div>
        <div class="text-body-small text-medium-emphasis">
          For example 1Password, Bitwarden, Google Authenticator or Microsoft Authenticator.
        </div>
      </li>
      <li>
        <div class="text-title-small font-weight-bold">Scan the QR code</div>
        <div class="d-flex flex-wrap ga-2 mt-1">
          <v-btn
            v-if="smAndDown && setup"
            :href="setup.uri"
            :append-icon="ExternalLink"
            variant="tonal"
            size="small"
            data-test="authenticator-open"
          >
            Open in your app
          </v-btn>
          <v-btn
            variant="text"
            size="small"
            class="px-2"
            data-test="authenticator-show-key"
            @click="showKey = !showKey"
          >
            {{ showKey ? 'Hide the key' : "Can't scan it? Enter a key instead" }}
          </v-btn>
        </div>
        <v-expand-transition>
          <CopyField
            v-if="showKey && setup"
            :value="grouped(setup.secret)"
            label="Setup key"
            class="mt-2"
            test-id="authenticator-key"
          />
        </v-expand-transition>
      </li>
      <li>
        <div class="text-title-small font-weight-bold mb-2">Enter the 6-digit code it shows</div>
        <CodeInput
          v-model="code"
          :disabled="!setup || expired || confirming.busy.value"
          :error="!!confirming.error.value"
          :autofocus="false"
          @complete="confirm"
        />
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          :text="error"
          data-test="authenticator-error"
        />
      </li>
    </ol>
  </div>
</template>

<style scoped>
.authenticator-setup {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 28px;
  align-items: start;
}

@media (max-width: 599px) {
  .authenticator-setup {
    grid-template-columns: 1fr;
    justify-items: center;
  }
}

.authenticator-setup__qr {
  padding: 12px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 12px 32px -16px rgba(15, 23, 42, 0.35);
}

.authenticator-setup__expired {
  width: 184px;
  height: 184px;
  color: #334155;
}

.authenticator-setup__steps {
  counter-reset: step;
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 18px;
  width: 100%;
}

.authenticator-setup__steps > li {
  counter-increment: step;
  position: relative;
  padding-inline-start: 40px;
}

.authenticator-setup__steps > li::before {
  content: counter(step);
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.8125rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}
</style>
