<script setup lang="ts">
import { ExternalLink, KeyRound, Plug, RotateCw, UserPlus } from '@lucide/vue'

import { useAuthStore } from '@/stores/auth'

/** What an admin does to set Plaid up, shown until Cashcove has Plaid's keys. */
const auth = useAuthStore()

const steps = [
  {
    icon: UserPlus,
    title: 'Create a Plaid account',
    text: 'Sign up at Plaid and ask for access to the Transactions product. The sandbox works straight away, with test banks.',
  },
  {
    icon: KeyRound,
    title: 'Copy your keys',
    text: 'Your client ID and secret are under Developers, then Keys, in Plaid’s dashboard.',
  },
  {
    icon: RotateCw,
    title: 'Add them to Cashcove',
    text: 'Put them in the .env file next to docker-compose.yml, then run make up to restart Cashcove with them.',
  },
]
</script>

<template>
  <v-card class="plaid-setup pa-6 pa-md-8 mb-6" data-test="plaid-setup">
    <div class="plaid-setup__glow" aria-hidden="true" />
    <div class="position-relative">
      <div class="d-flex align-center ga-4 mb-2">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="52">
          <v-icon :icon="Plug" size="26" />
        </v-avatar>
        <div>
          <h2 class="text-title-large font-weight-bold ma-0">Set up Plaid to connect banks</h2>
          <p class="text-body-medium text-medium-emphasis mb-0">
            Cashcove links to your banks through Plaid, which needs keys of your own.
          </p>
        </div>
      </div>

      <template v-if="auth.isAdmin">
        <ol class="plaid-setup__steps mt-6 pa-0">
          <li v-for="(step, index) in steps" :key="step.title" class="d-flex align-start ga-4 mb-5">
            <span class="plaid-setup__number" aria-hidden="true">{{ index + 1 }}</span>
            <div>
              <div class="text-title-small font-weight-bold">{{ step.title }}</div>
              <div class="text-body-medium text-medium-emphasis">{{ step.text }}</div>
            </div>
          </li>
        </ol>
        <pre class="plaid-setup__env text-body-small mb-6" data-test="plaid-setup-env">
CASHCOVE_PLAID_ENV=sandbox
CASHCOVE_PLAID_CLIENT_ID=your-client-id
CASHCOVE_PLAID_SECRET=your-secret</pre>
        <div class="d-flex flex-wrap ga-2">
          <v-btn
            color="primary"
            variant="flat"
            :append-icon="ExternalLink"
            href="https://dashboard.plaid.com/developers/keys"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Plaid’s dashboard
          </v-btn>
          <v-btn
            variant="outlined"
            :append-icon="ExternalLink"
            href="https://github.com/brianbaggs35/cashcove#plaid"
            target="_blank"
            rel="noopener noreferrer"
          >
            Setup guide
          </v-btn>
        </div>
      </template>
      <p v-else class="text-body-medium mt-4 mb-0">
        An admin needs to set up Plaid before banks can be connected.
      </p>
    </div>
  </v-card>
</template>

<style scoped>
.plaid-setup {
  position: relative;
  overflow: hidden;
}

.plaid-setup__glow {
  position: absolute;
  inset: -50% -10% auto auto;
  width: 420px;
  height: 320px;
  background: radial-gradient(
    closest-side,
    rgba(var(--v-theme-primary), 0.14),
    rgba(var(--v-theme-secondary), 0.06),
    transparent
  );
  pointer-events: none;
}

.plaid-setup__steps {
  list-style: none;
}

.plaid-setup__number {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-weight: 700;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-primary));
  background: rgb(var(--v-theme-primary));
}

.plaid-setup__env {
  padding: 14px 16px;
  overflow-x: auto;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
