<script setup lang="ts">
import { CircleCheckBig, Fingerprint, Smartphone, Sparkles } from '@lucide/vue'
import { computed, ref } from 'vue'

import type { Passkey } from '@/api/account'
import { addPasskeyToAccount } from '@/auth/passkeyFlows'
import AuthenticatorSetup from '@/components/auth/AuthenticatorSetup.vue'
import { useAction } from '@/composables/useAction'
import { useAuthStore } from '@/stores/auth'

/**
 * Offers a passkey and an authenticator app right after an account is created. Skippable:
 * both can be added later in Settings.
 */
const emit = defineEmits<{ continue: [] }>()

const auth = useAuthStore()
const passkey = ref<Passkey | null>(null)
const settingUpApp = ref(false)

const hasApp = computed(() => auth.user?.totp_enabled === true)
const protectedNow = computed(() => passkey.value !== null || hasApp.value)

const adding = useAction(async () => {
  passkey.value = (await addPasskeyToAccount()) ?? passkey.value
})
</script>

<template>
  <div class="secure-step">
    <v-expand-transition>
      <!-- Stays open after the app is confirmed, to show the recovery codes. -->
      <div v-if="settingUpApp" class="mb-2" data-test="secure-app-setup">
        <AuthenticatorSetup
          done-text="Continue"
          @finished="settingUpApp = false"
          @cancelled="settingUpApp = false"
        />
        <v-btn
          v-if="!hasApp"
          variant="text"
          class="mt-4 px-2"
          data-test="secure-app-back"
          @click="settingUpApp = false"
        >
          Back
        </v-btn>
      </div>
    </v-expand-transition>

    <div v-if="!settingUpApp" class="d-grid ga-4 secure-step__options">
      <v-card
        v-if="auth.passkeysAvailable"
        class="secure-step__option pa-5"
        :class="{ 'secure-step__option--done': passkey }"
        data-test="secure-passkey"
      >
        <div class="d-flex align-start ga-4">
          <v-avatar color="primary" variant="tonal" rounded="lg" size="48">
            <v-icon :icon="passkey ? CircleCheckBig : Fingerprint" size="24" />
          </v-avatar>
          <div class="flex-grow-1" style="min-width: 0">
            <div class="d-flex flex-wrap align-center ga-2">
              <span class="text-title-medium font-weight-bold">Passkey</span>
              <v-chip
                v-if="!passkey"
                color="accent"
                size="x-small"
                variant="tonal"
                :prepend-icon="Sparkles"
              >
                Recommended
              </v-chip>
            </div>
            <p v-if="passkey" class="text-body-medium mt-1 mb-0" data-test="secure-passkey-done">
              Added {{ passkey.name }}. Next time, sign in with your fingerprint, face or screen
              lock.
            </p>
            <template v-else>
              <p class="text-body-medium text-medium-emphasis mt-1 mb-3">
                Sign in with your fingerprint, face or screen lock. There's nothing to type, and it
                can't be phished or guessed.
              </p>
              <v-btn
                color="primary"
                variant="flat"
                :prepend-icon="Fingerprint"
                :loading="adding.busy.value"
                data-test="secure-add-passkey"
                @click="adding.run()"
              >
                Add a passkey
              </v-btn>
              <v-alert
                v-if="adding.error.value"
                type="error"
                variant="tonal"
                density="compact"
                class="mt-3"
                :text="adding.error.value"
              />
            </template>
          </div>
        </div>
      </v-card>

      <v-card
        class="secure-step__option pa-5"
        :class="{ 'secure-step__option--done': hasApp }"
        data-test="secure-app"
      >
        <div class="d-flex align-start ga-4">
          <v-avatar color="secondary" variant="tonal" rounded="lg" size="48">
            <v-icon :icon="hasApp ? CircleCheckBig : Smartphone" size="24" />
          </v-avatar>
          <div class="flex-grow-1">
            <div class="text-title-medium font-weight-bold">Authenticator app</div>
            <p v-if="hasApp" class="text-body-medium mt-1 mb-0" data-test="secure-app-done">
              Two-step verification is on. Cashcove asks for a code after your password.
            </p>
            <template v-else>
              <p class="text-body-medium text-medium-emphasis mt-1 mb-3">
                After your password, enter a 6-digit code from an app on your phone. It also
                protects sign-ins on devices without passkeys.
              </p>
              <v-btn
                variant="tonal"
                :prepend-icon="Smartphone"
                data-test="secure-setup-app"
                @click="settingUpApp = true"
              >
                Set up an authenticator app
              </v-btn>
            </template>
          </div>
        </div>
      </v-card>

      <div class="d-flex flex-wrap align-center ga-3 mt-2">
        <v-btn
          v-if="protectedNow"
          color="primary"
          variant="flat"
          size="large"
          data-test="secure-continue"
          @click="emit('continue')"
        >
          Continue
        </v-btn>
        <v-btn v-else variant="text" size="large" data-test="secure-skip" @click="emit('continue')">
          Skip for now
        </v-btn>
        <span v-if="!protectedNow" class="text-body-small text-medium-emphasis">
          You can add these any time in Settings.
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.secure-step__options {
  display: grid;
}

.secure-step__option {
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.secure-step__option--done {
  border-color: rgba(var(--v-theme-success), 0.5) !important;
  background: rgba(var(--v-theme-success), 0.05);
}
</style>
