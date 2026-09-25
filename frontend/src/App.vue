<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDisplay, useTheme } from 'vuetify'

import AppNavigation from '@/components/AppNavigation.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useThemeStore } from '@/stores/theme'

const { mobile } = useDisplay()
const theme = useTheme()
const themeStore = useThemeStore()
const route = useRoute()

// null lets Vuetify decide: open on desktop, closed on mobile.
const drawer = ref<boolean | null>(null)
const title = computed(() => route.meta.title ?? 'Cashcove')

watch(
  () => themeStore.preference,
  (preference) => theme.change(preference),
  { immediate: true },
)
</script>

<template>
  <v-app>
    <AppNavigation v-model="drawer" />

    <v-app-bar flat border="b" density="comfortable">
      <v-app-bar-nav-icon
        v-if="mobile"
        aria-label="Open navigation"
        data-test="nav-toggle"
        @click="drawer = !drawer"
      />
      <v-app-bar-title class="font-weight-semibold">{{ title }}</v-app-bar-title>
      <template #append>
        <ThemeToggle />
      </template>
    </v-app-bar>

    <v-main>
      <v-container class="py-6 py-md-8" style="max-width: 1200px">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>
