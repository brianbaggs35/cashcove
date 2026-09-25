<script setup lang="ts">
import type { NavItem } from '@/navigation'

defineProps<{ item: NavItem }>()
</script>

<template>
  <header class="d-flex flex-wrap align-center ga-4 mb-6">
    <v-avatar color="primary" variant="tonal" size="52" rounded="lg">
      <v-icon :icon="item.icon" size="26" />
    </v-avatar>
    <div class="flex-grow-1">
      <h1 class="text-h5 text-sm-h4 font-weight-bold">{{ item.title }}</h1>
      <p class="text-body-1 text-medium-emphasis mb-0">{{ item.summary }}</p>
    </div>
    <div v-if="$slots.actions" class="d-flex ga-2">
      <slot name="actions" />
    </div>
  </header>
</template>
