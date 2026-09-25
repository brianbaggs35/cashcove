<script setup lang="ts">
import { CircleCheck, Sparkles } from '@lucide/vue'

import type { NavItem } from '@/navigation'

defineProps<{ item: NavItem }>()
</script>

<template>
  <v-card class="feature-preview pa-2">
    <v-card-item>
      <template #prepend>
        <v-icon :icon="Sparkles" color="accent" />
      </template>
      <v-card-title>Coming soon</v-card-title>
      <v-card-subtitle>This tab is ready for its first features.</v-card-subtitle>
    </v-card-item>
    <v-card-text>
      <v-list density="comfortable" bg-color="transparent">
        <v-list-item v-for="feature in item.planned" :key="feature" :title="feature">
          <template #prepend>
            <v-icon :icon="CircleCheck" color="primary" size="20" />
          </template>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.feature-preview {
  background: linear-gradient(
    135deg,
    rgba(var(--v-theme-primary), 0.08),
    rgba(var(--v-theme-secondary), 0.06)
  );
}
</style>
