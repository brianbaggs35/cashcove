<script setup lang="ts">
import { ChevronLeft, ChevronRight, X } from '@lucide/vue'
import { computed } from 'vue'

import StatusIndicator from '@/components/StatusIndicator.vue'
import { useConnectionAlerts } from '@/composables/useConnectionAlerts'
import { navItems } from '@/navigation'
import { useAuthStore } from '@/stores/auth'

const props = withDefaults(defineProps<{ mobile?: boolean; collapsed?: boolean }>(), {
  mobile: false,
  collapsed: false,
})
const emit = defineEmits<{ collapse: [] }>()
const open = defineModel<boolean | null>({ default: null })
const alerts = useConnectionAlerts()
const auth = useAuthStore()
/** The tabs this person can open: some are for admins only. */
const items = computed(() => navItems.filter((item) => !item.admin || auth.isAdmin))
</script>

<template>
  <v-navigation-drawer
    id="app-navigation-drawer"
    v-model="open"
    :permanent="!props.mobile"
    :temporary="props.mobile"
    :rail="!props.mobile && props.collapsed"
    width="272"
    rail-width="88"
    class="app-nav"
    :class="{ 'app-nav--rail': props.collapsed && !props.mobile }"
    aria-label="Main navigation"
  >
    <div class="app-nav__header">
      <router-link
        to="/"
        class="app-nav__brand"
        :aria-label="props.collapsed && !props.mobile ? 'Cashcove home' : undefined"
        :title="props.collapsed && !props.mobile ? 'Cashcove home' : undefined"
      >
        <img
          src="/favicon.svg"
          alt=""
          :width="props.collapsed && !props.mobile ? 32 : 38"
          :height="props.collapsed && !props.mobile ? 32 : 38"
        />
        <div v-if="!props.collapsed || props.mobile" class="app-nav__brand-copy">
          <div class="text-title-large font-weight-bold">Cashcove</div>
          <div class="text-label-medium text-medium-emphasis">Personal finance</div>
        </div>
      </router-link>

      <v-btn
        v-if="props.mobile"
        :icon="X"
        variant="text"
        aria-label="Close navigation"
        aria-controls="app-navigation-drawer"
        data-test="mobile-nav-close"
        @click="open = false"
      />
      <v-btn
        v-else
        :icon="props.collapsed ? ChevronRight : ChevronLeft"
        variant="text"
        size="36"
        :aria-label="props.collapsed ? 'Expand navigation' : 'Collapse navigation'"
        :aria-expanded="!props.collapsed"
        aria-controls="app-navigation-drawer"
        data-test="nav-collapse-toggle"
        @click="emit('collapse')"
      />
    </div>

    <v-list tag="ul" nav class="px-3" color="primary" aria-label="Sections">
      <li v-for="item in items" :key="item.name">
        <v-list-item
          :to="item.path"
          :title="item.title"
          :aria-label="item.title"
          rounded="lg"
          class="app-nav__item mb-1"
        >
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
.app-nav__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 84px;
  padding: 16px 12px;
}

.app-nav__brand {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.app-nav__brand img {
  flex: 0 0 auto;
}

.app-nav__brand-copy {
  min-width: 0;
}

.app-nav--rail .app-nav__header {
  justify-content: center;
  gap: 4px;
  padding-inline: 8px;
}

.app-nav--rail .app-nav__brand {
  flex: 0 1 auto;
}

.app-nav__item :deep(.v-list-item-title) {
  font-size: 0.9375rem;
  font-weight: 500;
}

.app-nav__item :deep(.v-list-item__spacer) {
  width: 14px !important;
}
</style>
