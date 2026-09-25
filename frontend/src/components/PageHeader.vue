<script setup lang="ts">
import type { NavItem } from '@/navigation'

defineProps<{ item: NavItem }>()
</script>

<template>
  <header class="page-header d-flex flex-wrap align-center ga-4 mb-6 mb-md-8">
    <div class="d-flex align-center ga-4 flex-grow-1" style="min-width: 0">
      <v-avatar class="page-header__icon" size="52" rounded="lg">
        <v-icon :icon="item.icon" size="26" />
      </v-avatar>
      <div style="min-width: 0">
        <h1 class="text-headline-small text-md-headline-medium font-weight-bold ma-0">
          {{ item.title }}
        </h1>
        <p class="text-body-medium text-md-body-large text-medium-emphasis ma-0">
          {{ item.summary }}
        </p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header__actions d-flex ga-2">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header__icon {
  color: rgb(var(--v-theme-on-primary));
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary)));
  box-shadow: 0 8px 24px -8px rgba(var(--v-theme-primary), 0.6);
}
</style>
