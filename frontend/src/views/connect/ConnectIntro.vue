<script setup lang="ts">
import { ListChecks, Plug, RefreshCw, ShieldCheck } from '@lucide/vue'

/** What connecting a bank does, before any bank is connected. */
defineProps<{ canConnect: boolean; viewer: boolean }>()
const emit = defineEmits<{ connect: [] }>()

const benefits = [
  {
    icon: ShieldCheck,
    title: 'Private and secure',
    text: 'You sign in to your bank through Plaid. Cashcove never sees your password, and keeps Plaid’s access encrypted.',
  },
  {
    icon: ListChecks,
    title: 'You choose the accounts',
    text: 'Import only the accounts you want, name them your way, and change your mind at any time.',
  },
  {
    icon: RefreshCw,
    title: 'Always up to date',
    text: 'Transactions and balances sync on your schedule, straight into your transactions and budget.',
  },
]
</script>

<template>
  <v-card class="connect-intro pa-6 pa-md-10" data-test="connect-intro">
    <div class="connect-intro__glow" aria-hidden="true" />
    <div class="text-center position-relative">
      <div class="connect-intro__icon mx-auto mb-5">
        <v-icon :icon="Plug" size="36" />
      </div>
      <h2 class="text-headline-small font-weight-bold mb-2">Connect your first bank</h2>
      <p class="text-body-large text-medium-emphasis mx-auto mb-0" style="max-width: 540px">
        <template v-if="viewer">An admin hasn’t connected any banks yet.</template>
        <template v-else>
          Bring in accounts, balances and transactions automatically, instead of typing them in.
        </template>
      </p>
      <v-btn
        v-if="canConnect"
        color="primary"
        variant="flat"
        size="large"
        :prepend-icon="Plug"
        class="mt-6"
        data-test="connect-first"
        @click="emit('connect')"
      >
        Connect a bank
      </v-btn>
    </div>
    <v-row class="mt-8 position-relative" justify="center">
      <v-col v-for="benefit in benefits" :key="benefit.title" cols="12" md="4">
        <div class="connect-intro__tile pa-5 h-100">
          <v-avatar color="primary" variant="tonal" rounded="lg" size="40" class="mb-3">
            <v-icon :icon="benefit.icon" size="20" />
          </v-avatar>
          <div class="text-title-small font-weight-bold mb-1">{{ benefit.title }}</div>
          <div class="text-body-medium text-medium-emphasis">{{ benefit.text }}</div>
        </div>
      </v-col>
    </v-row>
  </v-card>
</template>

<style scoped>
.connect-intro {
  position: relative;
  overflow: hidden;
}

.connect-intro__glow {
  position: absolute;
  inset: -40% -10% auto;
  height: 360px;
  background: radial-gradient(
    closest-side,
    rgba(var(--v-theme-primary), 0.16),
    rgba(var(--v-theme-secondary), 0.08),
    transparent
  );
  pointer-events: none;
}

.connect-intro__icon {
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  border-radius: 24px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
}

.connect-intro__tile {
  border-radius: 16px;
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
