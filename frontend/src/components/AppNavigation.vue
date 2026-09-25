<script setup lang="ts">
import StatusIndicator from '@/components/StatusIndicator.vue'
import { navItems } from '@/navigation'

const open = defineModel<boolean | null>({ default: null })
</script>

<template>
  <v-navigation-drawer v-model="open" width="272" class="app-nav" aria-label="Main navigation">
    <router-link to="/" class="app-nav__brand d-flex align-center ga-3 px-5 pt-6 pb-5">
      <img src="/favicon.svg" alt="" width="38" height="38" />
      <div>
        <div class="text-title-large font-weight-bold">Cashcove</div>
        <div class="text-label-medium text-medium-emphasis">Personal finance</div>
      </div>
    </router-link>

    <v-list tag="ul" nav class="px-3" color="primary" aria-label="Sections">
      <li v-for="item in navItems" :key="item.name">
        <v-list-item :to="item.path" :title="item.title" rounded="lg" class="app-nav__item mb-1">
          <template #prepend>
            <v-icon :icon="item.icon" size="20" />
          </template>
        </v-list-item>
      </li>
    </v-list>

    <template #append>
      <v-list tag="ul" nav class="px-3 pb-3" aria-label="System">
        <li><StatusIndicator /></li>
      </v-list>
    </template>
  </v-navigation-drawer>
</template>

<style scoped>
.app-nav__brand {
  color: inherit;
  text-decoration: none;
}

.app-nav__item :deep(.v-list-item-title) {
  font-size: 0.9375rem;
  font-weight: 500;
}

.app-nav__item :deep(.v-list-item__spacer) {
  width: 14px !important;
}
</style>
