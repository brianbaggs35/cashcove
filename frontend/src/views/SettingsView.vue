<script setup lang="ts">
import { Activity, Paintbrush, RefreshCw } from '@lucide/vue'
import { onMounted } from 'vue'

import FeaturePreview from '@/components/FeaturePreview.vue'
import TabPage from '@/components/TabPage.vue'
import { findNavItem } from '@/navigation'
import { useHealthStore } from '@/stores/health'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const healthStore = useHealthStore()
const item = findNavItem('settings')

onMounted(() => healthStore.refresh())
</script>

<template>
  <TabPage name="settings">
    <v-row>
      <v-col cols="12" md="6">
        <v-card class="h-100">
          <v-card-item :prepend-icon="Paintbrush" title="Appearance" />
          <v-card-text>
            <p class="text-medium-emphasis mb-4">
              Choose a theme, or follow your device's setting.
            </p>
            <v-btn-toggle
              :model-value="themeStore.preference"
              mandatory
              color="primary"
              variant="outlined"
              divided
              data-test="theme-choice"
              @update:model-value="themeStore.setPreference"
            >
              <v-btn value="light">Light</v-btn>
              <v-btn value="dark">Dark</v-btn>
              <v-btn value="system">System</v-btn>
            </v-btn-toggle>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card class="h-100">
          <v-card-item :prepend-icon="Activity" title="System status">
            <template #append>
              <v-btn
                :icon="RefreshCw"
                variant="text"
                size="small"
                aria-label="Refresh status"
                :loading="healthStore.loading"
                data-test="refresh-health"
                @click="healthStore.refresh()"
              />
            </template>
          </v-card-item>
          <v-card-text>
            <v-alert
              v-if="healthStore.error"
              type="error"
              variant="tonal"
              density="compact"
              data-test="health-error"
            >
              Can't reach the Cashcove API: {{ healthStore.error }}
            </v-alert>
            <v-list v-else-if="healthStore.health" density="compact" bg-color="transparent">
              <v-list-item title="API" data-test="health-api">
                <template #append>
                  <v-chip
                    :color="healthStore.health.status === 'ok' ? 'success' : 'warning'"
                    size="small"
                    variant="tonal"
                  >
                    {{ healthStore.health.status === 'ok' ? 'Healthy' : 'Degraded' }}
                  </v-chip>
                </template>
              </v-list-item>
              <v-list-item title="Database" data-test="health-database">
                <template #append>
                  <v-chip
                    :color="healthStore.health.database === 'ok' ? 'success' : 'error'"
                    size="small"
                    variant="tonal"
                  >
                    {{ healthStore.health.database === 'ok' ? 'Connected' : 'Unavailable' }}
                  </v-chip>
                </template>
              </v-list-item>
              <v-list-item title="Version" :subtitle="healthStore.health.version" />
            </v-list>
            <v-skeleton-loader v-else type="list-item@3" />
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12">
        <FeaturePreview :item="item" />
      </v-col>
    </v-row>
  </TabPage>
</template>
