<script setup lang="ts">
import { Menu } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDisplay } from 'vuetify'

import AppNavigation from '@/components/AppNavigation.vue'
import OriginNotice from '@/components/auth/OriginNotice.vue'
import UserMenu from '@/components/auth/UserMenu.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useConnectionsStore } from '@/stores/connections'
import { useHealthStore } from '@/stores/health'
import { formatLongDate, greeting } from '@/utils/format'

// The signed-in app: navigation, the top bar and the current tab.
const { mobile } = useDisplay()
const route = useRoute()
const healthStore = useHealthStore()
const auth = useAuthStore()
const firstName = computed(() => auth.user?.name.split(' ')[0])

const drawer = ref<boolean | null>(null)
const navigationCollapsed = ref(false)
const now = new Date()

const connections = useConnectionsStore()

watch(mobile, (isMobile) => {
  drawer.value = isMobile ? false : null
})

watch(
  () => route.fullPath,
  () => {
    if (mobile.value) drawer.value = false
  },
)

function toggleMobileNavigation() {
  drawer.value = !(drawer.value ?? false)
}

function toggleNavigationRail() {
  navigationCollapsed.value = !navigationCollapsed.value
}

onMounted(() => {
  void healthStore.refresh()
  // The navigation points out banks that need attention, wherever people are.
  void connections.ensureLoaded()
})
</script>

<template>
  <AppNavigation
    v-model="drawer"
    :mobile="mobile"
    :collapsed="navigationCollapsed"
    @collapse="toggleNavigationRail"
  />

  <v-app-bar flat border="b" height="68" class="app-bar">
    <template #prepend>
      <v-btn
        v-if="mobile"
        icon
        variant="text"
        class="app-bar__menu"
        :aria-label="drawer ? 'Close navigation' : 'Open navigation'"
        :aria-expanded="drawer ?? false"
        aria-controls="app-navigation-drawer"
        data-test="mobile-nav-toggle"
        @click="toggleMobileNavigation"
      >
        <v-icon :icon="Menu" />
      </v-btn>
      <router-link
        v-if="mobile"
        to="/"
        class="app-bar__brand d-flex align-center ga-2"
        data-test="app-brand"
      >
        <img src="/favicon.svg" alt="" width="30" height="30" />
        <span class="text-title-large font-weight-bold">Cashcove</span>
      </router-link>
      <div v-else class="ps-6" data-test="app-greeting">
        <div class="text-title-medium font-weight-bold">
          {{ greeting(now) }}<template v-if="firstName">, {{ firstName }}</template>
        </div>
        <div class="text-label-medium text-medium-emphasis">{{ formatLongDate(now) }}</div>
      </div>
    </template>
    <template #append>
      <ThemeToggle />
      <UserMenu />
    </template>
  </v-app-bar>

  <v-main>
    <OriginNotice />
    <v-container class="app-main py-6 py-md-10 px-4 px-md-8">
      <router-view v-slot="{ Component }">
        <v-fade-transition mode="out-in">
          <component :is="Component" />
        </v-fade-transition>
      </router-view>
    </v-container>
  </v-main>
</template>

<style scoped>
.app-bar {
  backdrop-filter: saturate(180%) blur(12px);
  background: rgba(var(--v-theme-background), 0.8) !important;
}

.app-bar__menu {
  margin-inline-start: 8px;
}

.app-bar__brand {
  color: inherit;
  text-decoration: none;
  min-width: 0;
}

.app-main {
  width: 100%;
  min-width: 0;
  max-width: 1240px;
}
</style>
