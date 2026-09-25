<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileUp,
  House,
  KeySquare,
  LockKeyhole,
  PartyPopper,
  Plug,
  Server,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UserRound,
  Wallet,
} from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { checkSetupCode, completeSetup } from '@/api/auth'
import { ApiError } from '@/api/client'
import { fetchPreferences, savePreferences, type Preferences } from '@/api/preferences'
import { onboardingStep, saveOnboardingStep } from '@/auth/onboarding'
import SecureAccountStep from '@/components/auth/SecureAccountStep.vue'
import FormatPreview from '@/components/FormatPreview.vue'
import BrandMark from '@/components/ui/BrandMark.vue'
import PasswordField from '@/components/ui/PasswordField.vue'
import { useAction } from '@/composables/useAction'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { HOME } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { usePreferencesStore } from '@/stores/preferences'
import { currencyOptions, localeOptions } from '@/utils/regional'

type Step = 'welcome' | 'code' | 'account' | 'secure' | 'household' | 'done'

const STEPS: { key: Step; title: string; subtitle: string }[] = [
  { key: 'welcome', title: 'Welcome', subtitle: 'What Cashcove does' },
  { key: 'code', title: 'Setup code', subtitle: "Prove it's your server" },
  { key: 'account', title: 'Your account', subtitle: 'The first admin' },
  { key: 'secure', title: 'Protection', subtitle: 'Passkey or authenticator' },
  { key: 'household', title: 'Household', subtitle: 'Name and currency' },
  { key: 'done', title: 'All set', subtitle: 'Where to go next' },
]

const auth = useAuthStore()
const router = useRouter()
const preferencesStore = usePreferencesStore()

const step = ref<Step>(auth.setupRequired ? 'welcome' : (onboardingStep() ?? 'done'))
const index = computed(() => STEPS.findIndex((item) => item.key === step.value))
const current = computed(() => STEPS.find((item) => item.key === step.value))

const setupCode = ref('')
const name = ref('')
const email = ref('')
const password = ref('')
const preferences = ref<Preferences | null>(null)

watch(step, (value) => {
  // Once the account exists, a reload comes back to the same step.
  if (value === 'secure' || value === 'household' || value === 'done') saveOnboardingStep(value)
  window.scrollTo({ top: 0 })
})

const codeCheck = useAction(async () => {
  await checkSetupCode(setupCode.value.trim())
  step.value = 'account'
})

const creating = useAction(async () => {
  try {
    const state = await completeSetup({
      setup_code: setupCode.value.trim(),
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value,
    })
    auth.apply(state)
    password.value = ''
    step.value = 'secure'
  } catch (caught) {
    if (caught instanceof ApiError && caught.code === 'invalid_setup_code') step.value = 'code'
    if (caught instanceof ApiError && caught.code === 'already_set_up') {
      await router.replace({ name: 'sign-in' })
    }
    throw caught
  }
})

const loadingHousehold = useAction(async () => {
  preferences.value = await fetchPreferences()
})

const savingHousehold = useAction(async (changes: Preferences) => {
  const saved = await savePreferences(changes)
  preferencesStore.saved = saved
  preferencesStore.draft = JSON.parse(JSON.stringify(saved)) as Preferences
  step.value = 'done'
})

watch(
  step,
  (value) => {
    if (value === 'household' && !preferences.value) void loadingHousehold.run()
  },
  { immediate: true },
)

const accountErrors = computed(() => creating.error.value)
const nameRules = [(value: string) => value.trim().length > 0 || 'Tell Cashcove your name']
const emailRules = [
  (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'Enter a valid email address',
]
const householdRules = [(value: string) => value.trim().length > 0 || 'Give your household a name']

const accountValid = computed(
  () =>
    name.value.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) &&
    password.value.length > 0,
)

async function finish() {
  saveOnboardingStep(null)
  await router.replace(HOME)
}

onMounted(() => {
  // Arriving after setup finished elsewhere, e.g. in another tab.
  if (!auth.setupRequired && !auth.signedIn) void router.replace({ name: 'sign-in' })
})

const nextSteps = [
  {
    icon: Plug,
    title: 'Connect your bank',
    text: 'Link accounts through Plaid for automatic updates.',
    to: '/connect',
  },
  {
    icon: FileUp,
    title: 'Import a statement',
    text: 'Bring in CSV, OFX or QFX files from any bank.',
    to: '/import',
  },
  {
    icon: UserPlus,
    title: 'Invite your household',
    text: 'Add a partner or family as admins or viewers.',
    to: '/settings/users',
  },
]
</script>

<template>
  <AuthLayout :width="560">
    <template #aside>
      <BrandMark subtitle="Personal finance for your household" class="welcome__brand" />
      <div class="my-auto py-10">
        <div class="welcome__muted text-label-large mb-6">Setting up Cashcove</div>
        <ol class="welcome__rail" data-test="wizard-rail">
          <li
            v-for="(item, position) in STEPS"
            :key="item.key"
            class="welcome__rail-step"
            :class="{
              'welcome__rail-step--done': position < index,
              'welcome__rail-step--current': position === index,
            }"
            :aria-current="position === index ? 'step' : undefined"
          >
            <span class="welcome__rail-dot">
              <v-icon v-if="position < index" :icon="Check" size="16" />
              <template v-else>{{ position + 1 }}</template>
            </span>
            <div>
              <div class="text-title-small font-weight-bold">{{ item.title }}</div>
              <div class="text-body-small welcome__muted">{{ item.subtitle }}</div>
            </div>
          </li>
        </ol>
      </div>
      <div class="text-label-medium welcome__muted">Takes about two minutes</div>
    </template>

    <div class="welcome__progress d-md-none mb-8" data-test="wizard-progress">
      <div class="d-flex justify-space-between text-label-medium text-medium-emphasis mb-2">
        <span>Step {{ index + 1 }} of {{ STEPS.length }}</span>
        <span>{{ current?.title }}</span>
      </div>
      <v-progress-linear
        :model-value="((index + 1) / STEPS.length) * 100"
        color="primary"
        rounded
        height="6"
      />
    </div>

    <v-fade-transition mode="out-in">
      <!-- 1. Welcome -->
      <section v-if="step === 'welcome'" key="welcome" data-test="step-welcome">
        <div class="welcome__hero-icon mb-6">
          <v-icon :icon="Sparkles" size="30" />
        </div>
        <h1 class="welcome__title mb-3">Welcome to Cashcove</h1>
        <p class="text-body-large text-medium-emphasis mb-8">
          Your household's accounts, budgets and bills in one calm place, running on a server you
          own. Let's get it ready.
        </p>
        <div class="welcome__points mb-10">
          <div class="welcome__point">
            <v-icon :icon="Server" color="primary" size="22" />
            <div>
              <div class="text-title-small font-weight-bold">Private</div>
              <div class="text-body-small text-medium-emphasis">
                Everything stays on this server.
              </div>
            </div>
          </div>
          <div class="welcome__point">
            <v-icon :icon="ShieldCheck" color="primary" size="22" />
            <div>
              <div class="text-title-small font-weight-bold">Secure</div>
              <div class="text-body-small text-medium-emphasis">
                Passkeys, two-step codes and HTTPS.
              </div>
            </div>
          </div>
          <div class="welcome__point">
            <v-icon :icon="Wallet" color="primary" size="22" />
            <div>
              <div class="text-title-small font-weight-bold">Complete</div>
              <div class="text-body-small text-medium-emphasis">
                Accounts, budgets and subscriptions.
              </div>
            </div>
          </div>
        </div>
        <v-btn
          color="primary"
          variant="flat"
          size="x-large"
          :append-icon="ArrowRight"
          data-test="welcome-start"
          @click="step = 'code'"
        >
          Get started
        </v-btn>
      </section>

      <!-- 2. Setup code -->
      <section v-else-if="step === 'code'" key="code" data-test="step-code">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="52" class="mb-5">
          <v-icon :icon="LockKeyhole" size="26" />
        </v-avatar>
        <h1 class="welcome__title mb-3">Enter your setup code</h1>
        <p class="text-body-large text-medium-emphasis mb-6">
          This proves you're the one running this server. When Cashcove started, it printed a
          one-time code in its logs. To see a fresh one, run this where Cashcove is installed:
        </p>
        <pre class="welcome__command mb-6"><code>make setup-code</code></pre>
        <v-form @submit.prevent="codeCheck.run()">
          <v-text-field
            v-model="setupCode"
            label="Setup code"
            placeholder="xxxx-xxxx-xxxx"
            autocomplete="one-time-code"
            autocapitalize="off"
            spellcheck="false"
            autofocus
            class="welcome__code"
            :error-messages="codeCheck.error.value ?? undefined"
            data-test="setup-code"
          />
          <div class="d-flex align-center ga-3 mt-2">
            <v-btn variant="text" size="large" :prepend-icon="ArrowLeft" @click="step = 'welcome'">
              Back
            </v-btn>
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              size="large"
              :append-icon="ArrowRight"
              :loading="codeCheck.busy.value"
              :disabled="!setupCode.trim()"
              data-test="setup-code-submit"
            >
              Continue
            </v-btn>
          </div>
        </v-form>
      </section>

      <!-- 3. The admin account -->
      <section v-else-if="step === 'account'" key="account" data-test="step-account">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="52" class="mb-5">
          <v-icon :icon="UserRound" size="26" />
        </v-avatar>
        <h1 class="welcome__title mb-3">Create your account</h1>
        <p class="text-body-large text-medium-emphasis mb-8">
          You'll be this household's first admin. You can invite others once you're in.
        </p>
        <v-form @submit.prevent="accountValid && creating.run()">
          <v-text-field
            v-model="name"
            label="Your name"
            autocomplete="name"
            autofocus
            :rules="nameRules"
            class="mb-2"
            data-test="account-name"
          />
          <v-text-field
            v-model="email"
            label="Email"
            type="email"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            hint="You'll sign in with this. Cashcove never sends email."
            persistent-hint
            :rules="emailRules"
            class="mb-4"
            data-test="account-email"
          />
          <PasswordField
            v-model="password"
            label="Password"
            autocomplete="new-password"
            meter
            :context="{ email, name }"
            test-id="account-password"
          />
          <v-alert
            v-if="accountErrors"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-4"
            :text="accountErrors"
            data-test="account-error"
          />
          <div class="d-flex align-center ga-3 mt-6">
            <v-btn variant="text" size="large" :prepend-icon="ArrowLeft" @click="step = 'code'">
              Back
            </v-btn>
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              size="large"
              :append-icon="ArrowRight"
              :loading="creating.busy.value"
              :disabled="!accountValid"
              data-test="account-submit"
            >
              Create account
            </v-btn>
          </div>
        </v-form>
      </section>

      <!-- 4. Passkey or authenticator app -->
      <section v-else-if="step === 'secure'" key="secure" data-test="step-secure">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="52" class="mb-5">
          <v-icon :icon="KeySquare" size="26" />
        </v-avatar>
        <h1 class="welcome__title mb-3">Protect your account</h1>
        <p class="text-body-large text-medium-emphasis mb-8">
          Your account can see every balance and transaction, so add a second way to prove it's you.
          A stolen password alone won't get anyone in.
        </p>
        <SecureAccountStep @continue="step = 'household'" />
      </section>

      <!-- 5. Household -->
      <section v-else-if="step === 'household'" key="household" data-test="step-household">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="52" class="mb-5">
          <v-icon :icon="House" size="26" />
        </v-avatar>
        <h1 class="welcome__title mb-3">About your household</h1>
        <p class="text-body-large text-medium-emphasis mb-8">
          How Cashcove shows your money. You can change this later in Settings.
        </p>
        <v-form v-if="preferences" @submit.prevent="savingHousehold.run(preferences)">
          <v-text-field
            v-model="preferences.general.household_name"
            label="Household name"
            placeholder="The Riveras"
            :rules="householdRules"
            counter="80"
            class="mb-2"
            data-test="household-name"
          />
          <v-autocomplete
            v-model="preferences.general.currency"
            :items="currencyOptions"
            label="Currency"
            class="mb-2"
            data-test="household-currency"
          />
          <v-select
            v-model="preferences.general.locale"
            :items="localeOptions"
            label="Number and date format"
            class="mb-2"
            data-test="household-locale"
          />
          <FormatPreview
            :currency="preferences.general.currency"
            :locale="preferences.general.locale"
          />
          <v-alert
            v-if="savingHousehold.error.value"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-4"
            :text="savingHousehold.error.value"
          />
          <div class="d-flex align-center ga-3 mt-8">
            <v-btn variant="text" size="large" data-test="household-skip" @click="step = 'done'">
              Skip
            </v-btn>
            <v-btn
              type="submit"
              color="primary"
              variant="flat"
              size="large"
              :append-icon="ArrowRight"
              :loading="savingHousehold.busy.value"
              :disabled="!preferences.general.household_name.trim()"
              data-test="household-submit"
            >
              Save and continue
            </v-btn>
          </div>
        </v-form>
        <v-alert
          v-else-if="loadingHousehold.error.value"
          type="error"
          variant="tonal"
          :text="loadingHousehold.error.value"
          data-test="household-error"
        >
          <template #append>
            <v-btn variant="text" @click="loadingHousehold.run()">Try again</v-btn>
          </template>
        </v-alert>
        <v-skeleton-loader v-else type="text@3" data-test="household-loading" />
      </section>

      <!-- 6. Done -->
      <section v-else key="done" class="welcome__done" data-test="step-done">
        <div class="welcome__celebrate mb-6" aria-hidden="true">
          <v-icon :icon="PartyPopper" size="34" />
        </div>
        <h1 class="welcome__title mb-3">
          You're all set{{ auth.user ? `, ${auth.user.name.split(' ')[0]}` : '' }}
        </h1>
        <p class="text-body-large text-medium-emphasis mb-8">
          Cashcove is ready. Here are good places to start:
        </p>
        <div class="welcome__next mb-10">
          <router-link
            v-for="item in nextSteps"
            :key="item.to"
            :to="item.to"
            class="welcome__next-item"
            @click="saveOnboardingStep(null)"
          >
            <v-avatar color="primary" variant="tonal" rounded="lg" size="40">
              <v-icon :icon="item.icon" size="20" />
            </v-avatar>
            <div class="flex-grow-1">
              <div class="text-title-small font-weight-bold">{{ item.title }}</div>
              <div class="text-body-small text-medium-emphasis">{{ item.text }}</div>
            </div>
            <v-icon :icon="ArrowRight" size="18" class="text-medium-emphasis" />
          </router-link>
        </div>
        <v-btn
          color="primary"
          variant="flat"
          size="x-large"
          :append-icon="ArrowRight"
          data-test="welcome-finish"
          @click="finish"
        >
          Go to Cashcove
        </v-btn>
      </section>
    </v-fade-transition>
  </AuthLayout>
</template>

<style scoped>
.welcome__brand :deep(.text-medium-emphasis),
.welcome__muted {
  color: rgba(248, 250, 252, 0.72) !important;
}

.welcome__rail {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.welcome__rail-step {
  position: relative;
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 14px;
  opacity: 0.6;
  transition:
    opacity 0.3s,
    background-color 0.3s;
}

.welcome__rail-step--done {
  opacity: 0.85;
}

.welcome__rail-step--current {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}

.welcome__rail-dot {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 0.8125rem;
  font-weight: 700;
  border: 1.5px solid rgba(255, 255, 255, 0.5);
}

.welcome__rail-step--done .welcome__rail-dot {
  border-color: transparent;
  background: #2dd4bf;
  color: #042f2e;
}

.welcome__rail-step--current .welcome__rail-dot {
  border-color: #fff;
  background: #fff;
  color: #134e4a;
  box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.15);
}

.welcome__title {
  font-size: clamp(1.75rem, 3vw, 2.25rem);
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.welcome__hero-icon,
.welcome__celebrate {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 20px;
  color: #fff;
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary)));
  box-shadow: 0 16px 32px -12px rgba(var(--v-theme-primary), 0.6);
}

.welcome__celebrate {
  animation: pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes pop {
  from {
    transform: scale(0.4) rotate(-12deg);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .welcome__celebrate {
    animation: none;
  }
}

.welcome__points {
  display: grid;
  gap: 16px;
}

.welcome__point {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.welcome__command {
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 0.9375rem;
  background: rgba(var(--v-theme-surface-variant), 0.7);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.welcome__code :deep(input) {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 1.125rem;
  letter-spacing: 0.08em;
}

.welcome__next {
  display: grid;
  gap: 10px;
}

.welcome__next-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 16px;
  color: inherit;
  text-decoration: none;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
  transition:
    border-color 0.2s,
    transform 0.2s;
}

.welcome__next-item:hover,
.welcome__next-item:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.5);
  transform: translateY(-1px);
}
</style>
