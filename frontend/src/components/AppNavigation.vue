<script setup lang="ts">
import { computed } from 'vue'

import StatusIndicator from '@/components/StatusIndicator.vue'
import { useConnectionAlerts } from '@/composables/useConnectionAlerts'
import { navItems } from '@/navigation'
import { useAuthStore } from '@/stores/auth'

const open = defineModel<boolean | null>({ default: null })
const alerts = useConnectionAlerts()
const auth = useAuthStore()
/** The tabs this person can open: some are for admins only. */
const items = computed(() => navItems.filter((item) => !item.admin || auth.isAdmin))
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
      <li v-for="item in items" :key="item.name">
        <v-list-item :to="item.path" :title="item.title" rounded="lg" class="app-nav__item mb-1">
          <template #prepend>
            <v-icon :icon="item.icon" size="20" />
          </template>
          <template v-if="item.name === 'connect' && alerts.count.value" #append>
            <v-chip size="x-small" color="warning" variant="flat" data-test="nav-connect-alerts">
              {{ alerts.count.value }}
              <span class="d-sr-only">{{ alerts.label.value }}</span>
            </v-chip>
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
