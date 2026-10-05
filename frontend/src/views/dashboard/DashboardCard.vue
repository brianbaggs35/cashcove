<script setup lang="ts">
import { ArrowRight, type LucideIcon } from '@lucide/vue'

/** A card of the dashboard: what it's about, and where to see all of it. */
withDefaults(
  defineProps<{
    title: string
    icon: LucideIcon
    /** Where to see more, which shows a link in the corner. */
    to?: string
    linkLabel?: string
  }>(),
  { to: undefined, linkLabel: 'View all' },
)
</script>

<template>
  <v-card class="dashboard-card h-100">
    <v-card-text class="pa-5">
      <header class="d-flex align-center ga-2 mb-3">
        <v-icon :icon="icon" size="20" class="text-medium-emphasis" />
        <h2 class="text-title-medium font-weight-bold ma-0 flex-grow-1">{{ title }}</h2>
        <v-btn
          v-if="to"
          :to="to"
          variant="text"
          size="small"
          color="primary"
          :append-icon="ArrowRight"
          data-test="dashboard-card-link"
        >
          {{ linkLabel }}
        </v-btn>
      </header>
      <slot />
    </v-card-text>
  </v-card>
</template>
