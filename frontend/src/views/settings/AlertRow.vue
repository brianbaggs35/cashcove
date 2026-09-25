<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue'

defineProps<{ icon: LucideIcon; title: string; description: string; testId: string }>()
const enabled = defineModel<boolean>('enabled', { required: true })
</script>

<template>
  <div class="alert-row py-4" :data-test="testId">
    <div class="d-flex align-start ga-4">
      <v-avatar :color="enabled ? 'primary' : undefined" variant="tonal" rounded="lg" size="40">
        <v-icon :icon="icon" size="20" />
      </v-avatar>
      <div class="flex-grow-1" style="min-width: 0">
        <div class="text-title-small font-weight-bold">{{ title }}</div>
        <div class="text-body-small text-medium-emphasis">{{ description }}</div>
        <div v-if="$slots.default" class="alert-row__control mt-3" :class="{ 'is-off': !enabled }">
          <slot :disabled="!enabled" />
        </div>
      </div>
      <v-switch
        v-model="enabled"
        color="primary"
        inset
        hide-details
        density="compact"
        class="flex-grow-0"
        :aria-label="`${title} alert`"
      />
    </div>
  </div>
</template>

<style scoped>
.alert-row + .alert-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.alert-row__control {
  max-width: 320px;
  transition: opacity 0.2s;
}

.alert-row__control.is-off {
  opacity: 0.5;
}
</style>
