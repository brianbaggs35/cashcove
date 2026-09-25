<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useDisplay, useTheme } from 'vuetify'

import AppNavigation from '@/components/AppNavigation.vue'
import MobileBottomNav from '@/components/MobileBottomNav.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useHealthStore } from '@/stores/health'
import { useThemeStore } from '@/stores/theme'
import { formatLongDate, greeting } from '@/utils/format'

const { mobile } = useDisplay()
const theme = useTheme()
const themeStore = useThemeStore()
const healthStore = useHealthStore()

// null lets Vuetify decide: open on desktop, closed on mobile.
const drawer = ref<boolean | null>(null)
const now = new Date()

watch(
  () => themeStore.preference,
  (preference) => theme.change(preference),
  { immediate: true },
)

onMounted(() => healthStore.refresh())
</script>

<template>
  <v-app>
    <AppNavigation v-model="drawer" />

    <v-app-bar flat border="b" height="68" class="app-bar">
      <router-link
        v-if="mobile"
        to="/"
        class="app-bar__brand d-flex align-center ga-2 ps-4"
        data-test="app-brand"
      >
        <img src="/favicon.svg" alt="" width="30" height="30" />
        <span class="text-title-large font-weight-bold">Cashcove</span>
      </router-link>
      <div v-else class="ps-6" data-test="app-greeting">
        <div class="text-title-medium font-weight-bold">{{ greeting(now) }}</div>
        <div class="text-label-medium text-medium-emphasis">{{ formatLongDate(now) }}</div>
      </div>
      <template #append>
        <ThemeToggle />
      </template>
    </v-app-bar>

    <v-main>
      <v-container class="app-main py-6 py-md-10 px-4 px-md-8">
        <router-view v-slot="{ Component }">
          <v-fade-transition mode="out-in">
            <component :is="Component" />
          </v-fade-transition>
        </router-view>
      </v-container>
    </v-main>

    <MobileBottomNav v-if="mobile" @more="drawer = true" />
  </v-app>
</template>

<style scoped>
.app-bar {
  backdrop-filter: saturate(180%) blur(12px);
  background: rgba(var(--v-theme-background), 0.8) !important;
}

.app-bar__brand {
  color: inherit;
  text-decoration: none;
}

.app-main {
  max-width: 1240px;
}
</style>
