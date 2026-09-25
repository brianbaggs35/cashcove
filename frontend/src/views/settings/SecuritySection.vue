<script setup lang="ts">
import { CircleCheck, ShieldCheck } from '@lucide/vue'
import { useTemplateRef } from 'vue'

import { fetchActivity } from '@/api/account'
import { useAuthStore } from '@/stores/auth'
import ActivityCard from '@/views/settings/ActivityCard.vue'
import DevicesCard from '@/views/settings/security/DevicesCard.vue'
import PasskeysCard from '@/views/settings/security/PasskeysCard.vue'
import SecuritySummary from '@/views/settings/security/SecuritySummary.vue'
import TwoStepCard from '@/views/settings/security/TwoStepCard.vue'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const auth = useAuthStore()
const activity = useTemplateRef('activity')

/** Anything that changes how you sign in also shows up in your activity. */
function changed() {
  void activity.value?.reload()
}

const builtIn = [
  {
    title: 'Encrypted connections',
    text: 'HTTPS only, over TLS 1.3, with HTTP Strict Transport Security.',
  },
  {
    title: 'Guarded sign-ins',
    text: 'Too many wrong passwords or codes pause signing in for a while, and every attempt is logged.',
  },
  {
    title: 'Sessions that end',
    text: "You're signed out after an hour without activity, and remembered devices after 30 days.",
  },
  {
    title: 'Strict Content Security Policy',
    text: 'The browser only runs Cashcove code and Plaid Link, nothing else.',
  },
  {
    title: 'Private database',
    text: 'Postgres listens on a local socket inside the container and never on the network.',
  },
  {
    title: 'Secrets stay on the server',
    text: 'Passwords are hashed with Argon2id, and Plaid keys never reach the browser.',
  },
]
</script>

<template>
  <template v-if="auth.user">
    <SecuritySummary :user="auth.user" />
    <PasskeysCard :user="auth.user" @changed="changed" />
    <TwoStepCard :user="auth.user" @changed="changed" />
    <DevicesCard @changed="changed" />
    <ActivityCard
      ref="activity"
      title="Recent activity"
      subtitle="Sign-ins and changes to your account. If something here wasn't you, change your password and sign out everywhere else."
      :load="fetchActivity"
    />
  </template>

  <SettingsCard
    title="Built into Cashcove"
    subtitle="Protection every install has, whatever you choose above."
    :icon="ShieldCheck"
  >
    <v-row density="compact">
      <v-col v-for="item in builtIn" :key="item.title" cols="12" sm="6">
        <div class="d-flex ga-3 pa-3">
          <v-icon :icon="CircleCheck" color="success" size="20" class="mt-1" />
          <div>
            <div class="text-title-small font-weight-bold">{{ item.title }}</div>
            <div class="text-body-small text-medium-emphasis">{{ item.text }}</div>
          </div>
        </div>
      </v-col>
    </v-row>
  </SettingsCard>
</template>
