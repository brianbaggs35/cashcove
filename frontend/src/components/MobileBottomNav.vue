<script setup lang="ts">
import { Menu } from '@lucide/vue'

import { findNavItem } from '@/navigation'

const emit = defineEmits<{ more: [] }>()
const items = (['accounts', 'transactions', 'budget', 'subscriptions'] as const).map(findNavItem)
</script>

<template>
  <v-bottom-navigation grow color="primary" height="64" aria-label="Quick navigation">
    <v-btn
      v-for="item in items"
      :key="item.name"
      :to="item.path"
      :data-test="`bottom-${item.name}`"
    >
      <v-icon :icon="item.icon" size="22" />
      <span class="text-label-small mt-1">{{ item.title }}</span>
    </v-btn>
    <v-btn data-test="bottom-more" @click="emit('more')">
      <v-icon :icon="Menu" size="22" />
      <span class="text-label-small mt-1">More</span>
    </v-btn>
  </v-bottom-navigation>
</template>
