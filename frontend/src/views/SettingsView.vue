<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import { useRoute } from 'vue-router'

import TabPage from '@/components/TabPage.vue'
import { usePreferencesStore } from '@/stores/preferences'
import AlertsSection from '@/views/settings/AlertsSection.vue'
import AppearanceSection from '@/views/settings/AppearanceSection.vue'
import GeneralSection from '@/views/settings/GeneralSection.vue'
import SaveBar from '@/views/settings/SaveBar.vue'
import SecuritySection from '@/views/settings/SecuritySection.vue'
import { findSection, settingsSections, type SettingsSectionKey } from '@/views/settings/sections'
import SyncSection from '@/views/settings/SyncSection.vue'
import SystemSection from '@/views/settings/SystemSection.vue'
import UsersSection from '@/views/settings/UsersSection.vue'

const components: Record<SettingsSectionKey, Component> = {
  general: GeneralSection,
  users: UsersSection,
  alerts: AlertsSection,
  sync: SyncSection,
  security: SecuritySection,
  appearance: AppearanceSection,
  system: SystemSection,
}

const route = useRoute()
const store = usePreferencesStore()
const section = computed(() => findSection(route.params.section))
const notice = ref<{ text: string; color: string } | null>(null)

onMounted(() => {
  if (!store.saved) void store.load()
})

async function save() {
  notice.value = (await store.save())
    ? { text: 'Settings saved', color: 'success' }
    : { text: `Couldn't save: ${store.error ?? 'unknown error'}`, color: 'error' }
}
</script>

<template>
  <TabPage name="settings">
    <v-row>
      <v-col cols="12" md="4" lg="3">
        <v-card class="d-none d-md-block pa-2 settings-nav" data-test="settings-nav">
          <v-list nav color="primary" density="comfortable" class="pa-0">
            <v-list-item
              v-for="item in settingsSections"
              :key="item.key"
              :to="`/settings/${item.key}`"
              :active="item.key === section.key"
              :title="item.title"
              rounded="lg"
            >
              <template #prepend>
                <v-icon :icon="item.icon" size="20" class="me-n2" />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
        <v-slide-group class="d-md-none" show-arrows data-test="settings-chips">
          <v-chip
            v-for="item in settingsSections"
            :key="item.key"
            :to="`/settings/${item.key}`"
            :color="item.key === section.key ? 'primary' : undefined"
            :variant="item.key === section.key ? 'flat' : 'outlined'"
            :prepend-icon="item.icon"
            class="me-2"
          >
            {{ item.title }}
          </v-chip>
        </v-slide-group>
      </v-col>

      <v-col cols="12" md="8" lg="9">
        <component :is="components[section.key]" :key="section.key" />
      </v-col>
    </v-row>

    <SaveBar
      :visible="store.dirty && !!store.saved"
      :saving="store.saving"
      @save="save"
      @discard="store.discard()"
    />

    <v-snackbar
      :model-value="!!notice"
      :color="notice?.color"
      timeout="3000"
      location="top"
      data-test="settings-notice"
      @update:model-value="notice = null"
    >
      {{ notice?.text }}
    </v-snackbar>
  </TabPage>
</template>

<style scoped>
.settings-nav {
  position: sticky;
  top: 96px;
}
</style>
