<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue'

/**
 * One figure on a page: what it is, its value and a line of detail under it. On a phone the
 * tiles sit two by two, so the icon gives way to the words.
 */
defineProps<{ icon: LucideIcon; label: string }>()
</script>

<template>
  <v-card class="stat-tile h-100">
    <v-card-text class="stat-tile__body d-flex align-center ga-4 pa-5">
      <v-avatar class="stat-tile__icon" color="primary" variant="tonal" rounded="lg">
        <v-icon :icon="icon" aria-hidden="true" />
      </v-avatar>
      <div class="stat-tile__text">
        <p class="text-body-small text-medium-emphasis mb-1">{{ label }}</p>
        <p
          class="stat-tile__value text-title-large text-sm-headline-small font-weight-bold ma-0"
          data-test="stat-value"
        >
          <slot />
        </p>
        <p
          v-if="$slots.detail"
          class="text-body-small text-medium-emphasis ma-0 mt-1"
          data-test="stat-detail"
        >
          <slot name="detail" />
        </p>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.stat-tile__icon {
  flex-shrink: 0;
}

.stat-tile__text {
  min-width: 0;
}

.stat-tile__value {
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 599px) {
  .stat-tile__body {
    padding: 16px !important;
  }

  .stat-tile__icon {
    display: none;
  }
}
</style>
