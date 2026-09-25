<script setup lang="ts">
import { computed } from 'vue'

import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

const state = computed(() => {
  if (store.health?.status === 'ok') return { color: 'success', label: 'All systems normal' }
  if (store.health) return { color: 'warning', label: 'Database unavailable' }
  if (store.error) return { color: 'error', label: 'API unreachable' }
  return { color: 'grey', label: 'Checking status…' }
})
</script>

<template>
  <v-list-item
    to="/settings/system"
    rounded="lg"
    density="compact"
    class="status-indicator"
    data-test="status-indicator"
  >
    <template #prepend>
      <span class="status-indicator__dot" :class="`bg-${state.color}`" />
    </template>
    <v-list-item-title class="text-label-large">{{ state.label }}</v-list-item-title>
    <v-list-item-subtitle v-if="store.system"
      >Version {{ store.system.version }}</v-list-item-subtitle
    >
  </v-list-item>
</template>

<style scoped>
.status-indicator__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-inline: 7px 19px;
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(var(--v-theme-on-surface), 0.06);
}
</style>
