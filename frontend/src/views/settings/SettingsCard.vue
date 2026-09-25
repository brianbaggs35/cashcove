<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue'

defineProps<{ title: string; subtitle?: string; icon?: LucideIcon }>()
</script>

<template>
  <v-card class="settings-card mb-6">
    <v-card-item class="pt-5 px-5 px-md-6">
      <template v-if="icon" #prepend>
        <v-avatar color="primary" variant="tonal" rounded="lg" size="40">
          <v-icon :icon="icon" size="20" />
        </v-avatar>
      </template>
      <v-card-title class="text-title-medium font-weight-bold">{{ title }}</v-card-title>
      <v-card-subtitle v-if="subtitle" class="settings-card__subtitle">
        {{ subtitle }}
      </v-card-subtitle>
      <template v-if="$slots.append" #append><slot name="append" /></template>
    </v-card-item>
    <v-card-text class="px-5 px-md-6 pb-6">
      <slot />
    </v-card-text>
  </v-card>
</template>

<style scoped>
.settings-card__subtitle {
  white-space: normal;
}
</style>
