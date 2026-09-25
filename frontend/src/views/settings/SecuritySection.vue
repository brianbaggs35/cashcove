<script setup lang="ts">
import { CircleCheck, Clock, ShieldCheck, Sparkles } from '@lucide/vue'

import SettingsCard from '@/views/settings/SettingsCard.vue'

const inPlace = [
  {
    title: 'Encrypted connections',
    text: 'HTTPS only, TLS 1.2 or newer, with HTTP Strict Transport Security.',
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
    text: 'Plaid keys are read from the environment and never sent to the browser.',
  },
]

const upcoming = [
  'Passkeys and two-factor sign-in',
  'Active sessions you can sign out remotely',
  'Automatic sign-out after inactivity',
  'Login rate limiting and lockout',
  'An audit log of sensitive changes',
]
</script>

<template>
  <SettingsCard
    title="Already protecting you"
    subtitle="Built into every Cashcove install."
    :icon="ShieldCheck"
  >
    <v-row density="compact">
      <v-col v-for="item in inPlace" :key="item.title" cols="12" sm="6">
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

  <SettingsCard title="Coming with sign-in" :icon="Sparkles">
    <v-list bg-color="transparent" density="compact" class="pa-0">
      <v-list-item v-for="item in upcoming" :key="item" :title="item" class="px-0">
        <template #prepend>
          <v-icon :icon="Clock" size="18" class="me-n2" />
        </template>
      </v-list-item>
    </v-list>
  </SettingsCard>
</template>
