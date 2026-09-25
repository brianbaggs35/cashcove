<script setup lang="ts">
import { ArrowLeft, Fingerprint, KeyRound, LifeBuoy, LogIn, Smartphone } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { fetchPasskeys } from '@/api/account'
import {
  passkeySignInOptions,
  secondStepPasskeyOptions,
  signIn,
  signInSecondStepWithPasskey,
  signInWithPasskey,
  signInWithRecoveryCode,
  signInWithTotp,
  type SignInResult,
  type TwoFactorMethod,
} from '@/api/auth'
import { ApiError, errorMessage } from '@/api/client'
import { addPasskeyToAccount, answerWithPasskey } from '@/auth/passkeyFlows'
import {
  browserCanUpgradeToPasskey,
  browserHasPasskeyAutofill,
  cancelPasskeyPrompt,
  signalCurrentPasskeys,
  signalRemovedPasskey,
} from '@/auth/passkeys'
import AppDialog from '@/components/ui/AppDialog.vue'
import CodeInput from '@/components/ui/CodeInput.vue'
import PasswordField from '@/components/ui/PasswordField.vue'
import { notify } from '@/composables/notify'
import { useCountdown } from '@/composables/useCountdown'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { safeRedirect } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { formatCountdown } from '@/utils/format'

type Step = 'credentials' | 'totp' | 'recovery'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const step = ref<Step>('credentials')
const methods = ref<TwoFactorMethod[]>([])
const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const password = ref('')
const remember = ref(false)
const code = ref('')
const recoveryCode = ref('')
const busy = ref<'password' | 'passkey' | 'code' | null>(null)
const error = ref<string | null>(null)
const lockedUntil = ref<number | null>(null)
const forgotOpen = ref(false)
const { remaining: lockSeconds } = useCountdown(lockedUntil)

const notices = {
  signed_out: { type: 'info', text: "You've signed out. See you soon." },
  expired: {
    type: 'info',
    text: 'Your session ended. Sign in again to pick up where you left off.',
  },
  password_reset: { type: 'success', text: 'Your password was changed. Sign in with the new one.' },
} as const
const notice = computed(() => (auth.signedOutReason ? notices[auth.signedOutReason] : null))

const locked = computed(() => lockSeconds.value > 0)
const canUsePasskey = computed(() => auth.passkeysAvailable)
const secondStepPasskey = computed(() => methods.value.includes('passkey') && canUsePasskey.value)

function show(caught: unknown) {
  if (caught instanceof ApiError && caught.retryAfter) {
    lockedUntil.value = Date.now() + caught.retryAfter * 1000
  }
  if (caught instanceof ApiError && caught.code === 'sign_in_expired') {
    step.value = 'credentials'
    code.value = ''
    recoveryCode.value = ''
  }
  error.value = errorMessage(caught)
}

/** Runs one sign-in attempt, keeping only one going at a time. */
async function attempt(kind: 'password' | 'passkey' | 'code', run: () => Promise<void>) {
  if (busy.value) return
  busy.value = kind
  error.value = null
  try {
    await run()
  } catch (caught) {
    show(caught)
  } finally {
    busy.value = null
  }
}

async function finish(result: SignInResult | null, method: 'password' | 'other') {
  if (!result) return
  if (result.status === 'two_factor_required') {
    methods.value = result.methods
    step.value = 'totp'
    password.value = ''
    return
  }
  if (result.state) auth.apply(result.state)
  void afterSignIn(method)
  await router.replace(safeRedirect(route.query.redirect))
}

/** Background tidying once signed in; nothing here should get in the way. */
async function afterSignIn(method: 'password' | 'other') {
  const user = auth.user
  if (!user || !auth.passkeysAvailable) return
  try {
    const passkeys = await fetchPasskeys()
    await signalCurrentPasskeys(
      auth.origin,
      user.webauthn_user_id,
      passkeys.map((passkey) => passkey.credential_id),
    )
    // People who sign in with a password can get a passkey saved quietly by their password
    // manager, where the browser supports it; they're told when it happens.
    if (method === 'password' && passkeys.length === 0 && (await browserCanUpgradeToPasskey())) {
      if (await addPasskeyToAccount('', { quietly: true })) {
        notify('Passkey saved. Next time, sign in with your fingerprint, face or screen lock.')
      }
    }
  } catch {
    // Best effort only.
  }
}

function signInWithPassword() {
  if (!email.value || !password.value || locked.value) return
  void attempt('password', async () => {
    await finish(await signIn(email.value, password.value, remember.value), 'password')
  })
}

function passkeyFailed(caught: unknown, credentialId: string): never {
  if (caught instanceof ApiError && caught.data.unknown_credential === true) {
    void signalRemovedPasskey(auth.origin, credentialId)
  }
  throw caught
}

/** Passwordless sign-in, from the button or from the email field's autofill menu. */
async function signInWithPasskeyPrompt(autofill: boolean) {
  const result = await answerWithPasskey(
    passkeySignInOptions,
    (challengeId, credential) =>
      signInWithPasskey(challengeId, credential, remember.value).catch((caught: unknown) =>
        passkeyFailed(caught, credential.id),
      ),
    { autofill },
  )
  await finish(result, 'other')
}

function signInWithPasskeyButton() {
  void attempt('passkey', () => signInWithPasskeyPrompt(false)).then(startAutofill)
}

/** Offers passkeys in the email field's autofill menu, where the browser supports it. */
async function startAutofill() {
  if (!canUsePasskey.value || auth.signedIn || step.value !== 'credentials') return
  if (!(await browserHasPasskeyAutofill())) return
  try {
    await signInWithPasskeyPrompt(true)
  } catch (caught) {
    // Autofill runs quietly in the background; only a real answer from Cashcove is shown.
    if (caught instanceof ApiError) show(caught)
  }
}

function submitCode() {
  if (code.value.length < 6) return
  void attempt('code', async () => {
    try {
      await finish(await signInWithTotp(code.value), 'other')
    } finally {
      code.value = ''
    }
  })
}

function submitRecoveryCode() {
  if (!recoveryCode.value) return
  void attempt('code', async () => {
    await finish(await signInWithRecoveryCode(recoveryCode.value), 'other')
  })
}

function useSecondStepPasskey() {
  void attempt('passkey', async () => {
    await finish(
      await answerWithPasskey(secondStepPasskeyOptions, signInSecondStepWithPasskey),
      'other',
    )
  })
}

function startOver() {
  step.value = 'credentials'
  error.value = null
  code.value = ''
  recoveryCode.value = ''
  void startAutofill()
}

function switchTo(next: Step) {
  step.value = next
  error.value = null
}

onMounted(() => void startAutofill())
onBeforeUnmount(cancelPasskeyPrompt)
</script>

<template>
  <AuthLayout>
    <!-- Email and password -->
    <section v-if="step === 'credentials'" data-test="step-credentials">
      <h1 class="text-headline-medium font-weight-bold mb-1">Welcome back</h1>
      <p class="text-body-large text-medium-emphasis mb-8">Sign in to your household's Cashcove.</p>

      <v-alert
        v-if="notice && !error"
        :type="notice.type"
        variant="tonal"
        density="compact"
        class="mb-6"
        :text="notice.text"
        data-test="sign-in-notice"
      />

      <v-btn
        v-if="canUsePasskey"
        block
        size="x-large"
        variant="outlined"
        class="sign-in__passkey mb-6"
        :prepend-icon="Fingerprint"
        :loading="busy === 'passkey'"
        :disabled="locked || (busy !== null && busy !== 'passkey')"
        data-test="sign-in-passkey"
        @click="signInWithPasskeyButton"
      >
        Sign in with a passkey
      </v-btn>
      <div
        v-if="canUsePasskey"
        class="sign-in__divider text-label-medium text-medium-emphasis mb-6"
      >
        or use your password
      </div>

      <v-form @submit.prevent="signInWithPassword">
        <v-text-field
          v-model="email"
          label="Email"
          type="email"
          autocomplete="username webauthn"
          autocapitalize="off"
          spellcheck="false"
          :autofocus="!canUsePasskey"
          class="mb-3"
          hide-details="auto"
          data-test="sign-in-email"
        />
        <PasswordField
          v-model="password"
          autocomplete="current-password"
          test-id="sign-in-password"
        />
        <div class="d-flex align-center justify-space-between flex-wrap mt-2 mb-4">
          <v-checkbox
            v-model="remember"
            color="primary"
            density="compact"
            hide-details
            data-test="sign-in-remember"
          >
            <template #label>
              <span>
                Keep me signed in
                <span class="text-medium-emphasis">for 30 days</span>
              </span>
            </template>
          </v-checkbox>
          <v-btn
            variant="text"
            size="small"
            class="px-2"
            data-test="sign-in-forgot"
            @click="forgotOpen = true"
          >
            Forgot password?
          </v-btn>
        </div>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
          data-test="sign-in-error"
        >
          {{ locked ? `Too many attempts. Try again in ${formatCountdown(lockSeconds)}.` : error }}
        </v-alert>

        <v-btn
          type="submit"
          block
          size="x-large"
          color="primary"
          variant="flat"
          :append-icon="LogIn"
          :loading="busy === 'password'"
          :disabled="!email || !password || locked || (busy !== null && busy !== 'password')"
          data-test="sign-in-submit"
        >
          Sign in
        </v-btn>
      </v-form>
      <p v-if="remember" class="text-body-small text-medium-emphasis mt-4 mb-0">
        Only use this on a device that's just yours.
      </p>
    </section>

    <!-- Code from an authenticator app -->
    <section v-else-if="step === 'totp'" data-test="step-totp">
      <v-avatar color="primary" variant="tonal" rounded="lg" size="52" class="mb-5">
        <v-icon :icon="Smartphone" size="26" />
      </v-avatar>
      <h1 class="text-headline-medium font-weight-bold mb-1">Two-step verification</h1>
      <p class="text-body-large text-medium-emphasis mb-8">
        Enter the 6-digit code from your authenticator app.
      </p>
      <v-form @submit.prevent="submitCode">
        <CodeInput
          v-model="code"
          :disabled="busy !== null || locked"
          :error="!!error"
          @complete="submitCode"
        />
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          data-test="sign-in-error"
        >
          {{ locked ? `Too many attempts. Try again in ${formatCountdown(lockSeconds)}.` : error }}
        </v-alert>
        <v-btn
          type="submit"
          block
          size="x-large"
          color="primary"
          variant="flat"
          class="mt-6"
          :loading="busy === 'code'"
          :disabled="code.length < 6 || locked"
          data-test="totp-submit"
        >
          Verify
        </v-btn>
      </v-form>
      <div class="d-flex flex-column align-start ga-1 mt-6">
        <v-btn
          v-if="secondStepPasskey"
          variant="text"
          class="px-2"
          :prepend-icon="Fingerprint"
          :loading="busy === 'passkey'"
          data-test="use-passkey-instead"
          @click="useSecondStepPasskey"
        >
          Use a passkey instead
        </v-btn>
        <v-btn
          variant="text"
          class="px-2"
          :prepend-icon="LifeBuoy"
          data-test="use-recovery-code"
          @click="switchTo('recovery')"
        >
          Use a recovery code
        </v-btn>
        <v-btn
          variant="text"
          class="px-2"
          :prepend-icon="ArrowLeft"
          data-test="start-over"
          @click="startOver"
        >
          Start over
        </v-btn>
      </div>
    </section>

    <!-- Recovery code -->
    <section v-else data-test="step-recovery">
      <v-avatar color="warning" variant="tonal" rounded="lg" size="52" class="mb-5">
        <v-icon :icon="LifeBuoy" size="26" />
      </v-avatar>
      <h1 class="text-headline-medium font-weight-bold mb-1">Use a recovery code</h1>
      <p class="text-body-large text-medium-emphasis mb-8">
        Enter one of the recovery codes you saved when you turned on two-step verification. Each
        code works once.
      </p>
      <v-form @submit.prevent="submitRecoveryCode">
        <v-text-field
          v-model="recoveryCode"
          label="Recovery code"
          placeholder="xxxx-xxxx-xxxx-xxxx"
          autocomplete="one-time-code"
          autocapitalize="off"
          spellcheck="false"
          autofocus
          class="sign-in__recovery"
          hide-details="auto"
          data-test="recovery-code"
        />
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          data-test="sign-in-error"
        >
          {{ locked ? `Too many attempts. Try again in ${formatCountdown(lockSeconds)}.` : error }}
        </v-alert>
        <v-btn
          type="submit"
          block
          size="x-large"
          color="primary"
          variant="flat"
          class="mt-6"
          :loading="busy === 'code'"
          :disabled="!recoveryCode || locked"
          data-test="recovery-submit"
        >
          Sign in
        </v-btn>
      </v-form>
      <v-btn
        variant="text"
        class="px-2 mt-6"
        :prepend-icon="ArrowLeft"
        data-test="back-to-code"
        @click="switchTo('totp')"
      >
        Use the authenticator app instead
      </v-btn>
    </section>

    <AppDialog v-model="forgotOpen" title="Forgot your password?" :icon="KeyRound" max-width="480">
      <p class="text-body-medium">
        Cashcove runs on your own server, so there's no email reset. Instead, ask an admin in your
        household to create a reset link for you in <strong>Settings → Users</strong>.
      </p>
      <p class="text-body-medium mb-0">
        If you're the only admin, run this where Cashcove is installed, then open the link it
        prints:
      </p>
      <pre
        class="sign-in__command mt-3"
      ><code>make reset-link EMAIL={{ email || 'you@example.com' }}</code></pre>
      <template #actions>
        <v-btn color="primary" variant="flat" @click="forgotOpen = false">Got it</v-btn>
      </template>
    </AppDialog>
  </AuthLayout>
</template>

<style scoped>
.sign-in__divider {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sign-in__divider::before,
.sign-in__divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.sign-in__passkey {
  border-color: rgba(var(--v-border-color), 0.24);
}

.sign-in__recovery :deep(input) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  letter-spacing: 0.04em;
}

.sign-in__command {
  padding: 12px 16px;
  border-radius: 12px;
  overflow-x: auto;
  font-size: 0.875rem;
  background: rgba(var(--v-theme-surface-variant), 0.7);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
