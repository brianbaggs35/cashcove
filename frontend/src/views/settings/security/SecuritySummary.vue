<script setup lang="ts">
import {
  CircleCheck,
  CircleDashed,
  Fingerprint,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from '@lucide/vue'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import type { User } from '@/api/auth'

/** How well the account is protected, at a glance, with shortcuts to each way of signing in. */
const props = defineProps<{ user: User }>()
const router = useRouter()

interface Check {
  key: string
  title: string
  icon: LucideIcon
  done: boolean
  status: string
  /** Where the setting lives: another page, or a card further down this one. */
  to: string
}

const checks = computed<Check[]>(() => {
  const passkeys = props.user.passkey_count
  const app = props.user.totp_enabled
  return [
    {
      key: 'password',
      title: 'Password',
      icon: KeyRound,
      done: true,
      status: 'Change it in Account',
      to: '/settings/account',
    },
    {
      key: 'passkeys',
      title: 'Passkeys',
      icon: Fingerprint,
      done: passkeys > 0,
      status: passkeys === 0 ? 'Add one' : passkeys === 1 ? '1 saved' : `${passkeys} saved`,
      to: '#passkeys',
    },
    {
      key: 'app',
      title: 'Authenticator app',
      icon: Smartphone,
      done: app,
      status: app ? 'On' : 'Off',
      to: '#two-step',
    },
  ]
})

const summary = computed(() => {
  const { passkey_count: passkeys, totp_enabled: app } = props.user
  if (app) {
    return {
      tone: 'success',
      icon: ShieldCheck,
      title: 'Your account is well protected',
      text: passkeys
        ? 'You can sign in with a passkey, and signing in with your password also needs a code from your phone.'
        : 'Signing in with your password also needs a code from your phone. Add a passkey for quicker sign-ins.',
    }
  }
  if (passkeys) {
    return {
      tone: 'primary',
      icon: ShieldCheck,
      title: 'Passkeys keep signing in safe and quick',
      text: 'Your password still works on its own, though. Turn on two-step verification so it also needs a code from your phone.',
    }
  }
  return {
    tone: 'warning',
    icon: ShieldAlert,
    title: 'Only your password protects your account',
    text: 'Anyone who learns it can sign in. Add a passkey or an authenticator app to keep your finances safe.',
  }
})

function open(check: Check) {
  if (check.to.startsWith('#')) {
    document.querySelector(check.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else {
    void router.push(check.to)
  }
}
</script>

<template>
  <v-card
    class="security-summary mb-6 pa-5 pa-md-6"
    :class="`security-summary--${summary.tone}`"
    data-test="security-summary"
  >
    <div class="d-flex align-start ga-4">
      <v-avatar :color="summary.tone" variant="flat" rounded="lg" size="52">
        <v-icon :icon="summary.icon" size="26" />
      </v-avatar>
      <div style="min-width: 0">
        <h2 class="text-title-large font-weight-bold ma-0" data-test="security-summary-title">
          {{ summary.title }}
        </h2>
        <p class="text-body-medium text-medium-emphasis mt-1 mb-0">{{ summary.text }}</p>
      </div>
    </div>
    <div class="security-checks mt-5">
      <button
        v-for="check in checks"
        :key="check.key"
        type="button"
        class="security-check d-flex align-center ga-3 pa-3 text-start"
        :data-test="`security-check-${check.key}`"
        @click="open(check)"
      >
        <v-icon :icon="check.icon" size="20" class="text-medium-emphasis" />
        <span class="flex-grow-1" style="min-width: 0">
          <span class="d-block text-title-small font-weight-bold">{{ check.title }}</span>
          <span class="d-block text-body-small text-medium-emphasis">{{ check.status }}</span>
        </span>
        <v-icon
          :icon="check.done ? CircleCheck : CircleDashed"
          :color="check.done ? 'success' : undefined"
          size="20"
          :class="{ 'text-disabled': !check.done }"
          :data-test="`security-check-${check.key}-${check.done ? 'done' : 'todo'}`"
        />
      </button>
    </div>
  </v-card>
</template>

<style scoped>
.security-summary {
  --summary-color: var(--v-theme-primary);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(var(--summary-color), 0.14), transparent 60%),
    rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--summary-color), 0.25);
}

.security-summary--success {
  --summary-color: var(--v-theme-success);
}

.security-summary--warning {
  --summary-color: var(--v-theme-warning);
}

.security-checks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.security-check {
  width: 100%;
  border-radius: 14px;
  color: inherit;
  background: rgba(var(--v-theme-surface), 0.7);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.security-check:hover {
  border-color: rgba(var(--summary-color), 0.5);
  background: rgba(var(--summary-color), 0.06);
}

.security-check:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
