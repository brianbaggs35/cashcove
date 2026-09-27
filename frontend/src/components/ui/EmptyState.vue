<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue'

/** What a list shows when it has nothing in it: what's missing, and what to do about it. */
withDefaults(defineProps<{ icon: LucideIcon; title: string; text?: string; compact?: boolean }>(), {
  text: undefined,
  compact: false,
})
</script>

<template>
  <div
    class="empty-state text-center px-4"
    :class="compact ? 'py-8' : 'py-12 py-md-16'"
    data-test="empty-state"
  >
    <div class="empty-state__icon mx-auto mb-4" :class="{ 'empty-state__icon--compact': compact }">
      <v-icon :icon="icon" :size="compact ? 24 : 30" />
    </div>
    <p class="text-title-medium font-weight-bold mb-1">{{ title }}</p>
    <p v-if="text" class="empty-state__text text-body-medium text-medium-emphasis mx-auto mb-0">
      {{ text }}
    </p>
    <div v-if="$slots.default" class="d-flex flex-wrap justify-center ga-2 mt-5">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state__icon {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 20px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
}

.empty-state__icon--compact {
  width: 52px;
  height: 52px;
  border-radius: 16px;
}

.empty-state__text {
  max-width: 460px;
}
</style>
