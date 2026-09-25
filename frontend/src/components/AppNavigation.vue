<script setup lang="ts">
import { navItems } from '@/navigation'

const open = defineModel<boolean | null>({ default: null })
defineProps<{ version?: string }>()
</script>

<template>
  <v-navigation-drawer v-model="open" width="264" class="app-nav" aria-label="Main navigation">
    <div class="d-flex align-center ga-3 px-5 pt-6 pb-4">
      <img src="/favicon.svg" alt="" width="36" height="36" />
      <div>
        <div class="text-h6 font-weight-bold">Cashcove</div>
        <div class="text-caption text-medium-emphasis">Personal finance</div>
      </div>
    </div>

    <v-list nav density="comfortable" class="px-3" color="primary">
      <v-list-item
        v-for="item in navItems"
        :key="item.name"
        :to="item.path"
        :title="item.title"
        :prepend-icon="item.icon"
        rounded="lg"
        class="mb-1"
      />
    </v-list>

    <template #append>
      <div v-if="version" class="px-5 pb-4 text-caption text-medium-emphasis">
        Version {{ version }}
      </div>
    </template>
  </v-navigation-drawer>
</template>

<style scoped>
.app-nav :deep(.v-list-item-title) {
  font-weight: 500;
}
</style>
