<script setup lang="ts">
import { CircleCheck, Sparkles } from '@lucide/vue'

import type { NavItem } from '@/navigation'

defineProps<{ item: NavItem }>()
</script>

<template>
  <v-card class="feature-preview pa-6 pa-md-10">
    <div class="feature-preview__glow" aria-hidden="true" />
    <div class="text-center position-relative">
      <div class="feature-preview__icon mx-auto mb-5">
        <v-icon :icon="item.icon" size="36" />
      </div>
      <v-chip color="accent" variant="tonal" size="small" :prepend-icon="Sparkles">
        Coming soon
      </v-chip>
      <h2 class="text-title-large font-weight-bold mt-3 mb-1">
        {{ item.title }} is ready for its first features
      </h2>
      <p class="text-body-medium text-medium-emphasis mx-auto mb-0" style="max-width: 520px">
        Here's what's planned for this tab.
      </p>
    </div>
    <v-row class="mt-6 position-relative" justify="center">
      <v-col v-for="feature in item.planned" :key="feature" cols="12" sm="6" md="4">
        <div class="feature-preview__tile d-flex align-start ga-3 pa-4 h-100">
          <v-icon :icon="CircleCheck" color="primary" size="20" class="mt-1 flex-shrink-0" />
          <span class="text-body-medium">{{ feature }}</span>
        </div>
      </v-col>
    </v-row>
  </v-card>
</template>

<style scoped>
.feature-preview {
  position: relative;
  overflow: hidden;
}

.feature-preview__glow {
  position: absolute;
  inset: -40% -10% auto;
  height: 320px;
  background: radial-gradient(
    closest-side,
    rgba(var(--v-theme-primary), 0.16),
    rgba(var(--v-theme-secondary), 0.08),
    transparent
  );
  pointer-events: none;
}

.feature-preview__icon {
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  border-radius: 24px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
}

.feature-preview__tile {
  border-radius: 16px;
  background: rgba(var(--v-theme-surface-variant), 0.5);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
