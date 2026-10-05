<script setup lang="ts">
import { Menu } from '@lucide/vue'

import { useConnectionAlerts } from '@/composables/useConnectionAlerts'
import { findNavItem } from '@/navigation'

const emit = defineEmits<{ more: [] }>()
const alerts = useConnectionAlerts()
const items = (['dashboard', 'accounts', 'transactions', 'budget'] as const).map(findNavItem)
</script>

<template>
  <v-bottom-navigation tag="nav" grow color="primary" height="64" aria-label="Quick navigation">
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
      <v-badge
        :model-value="!!alerts.count.value"
        color="warning"
        dot
        data-test="bottom-more-alert"
      >
        <v-icon :icon="Menu" size="22" />
      </v-badge>
      <span class="text-label-small mt-1">More</span>
      <span v-if="alerts.count.value" class="d-sr-only">, {{ alerts.label.value }}</span>
    </v-btn>
  </v-bottom-navigation>
</template>
