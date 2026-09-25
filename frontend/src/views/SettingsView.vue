<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import { useRoute } from 'vue-router'

import TabPage from '@/components/TabPage.vue'
import { notify } from '@/composables/notify'
import { useAuthStore } from '@/stores/auth'
import { usePreferencesStore } from '@/stores/preferences'
import AccountSection from '@/views/settings/AccountSection.vue'
import AlertsSection from '@/views/settings/AlertsSection.vue'
import AppearanceSection from '@/views/settings/AppearanceSection.vue'
import GeneralSection from '@/views/settings/GeneralSection.vue'
import SaveBar from '@/views/settings/SaveBar.vue'
import SecuritySection from '@/views/settings/SecuritySection.vue'
import {
  findSection,
  settingsGroups,
  settingsSections,
  type SettingsSectionKey,
} from '@/views/settings/sections'
import SyncSection from '@/views/settings/SyncSection.vue'
import SystemSection from '@/views/settings/SystemSection.vue'
import UsersSection from '@/views/settings/UsersSection.vue'

const components: Record<SettingsSectionKey, Component> = {
  general: GeneralSection,
  users: UsersSection,
  alerts: AlertsSection,
  sync: SyncSection,
  account: AccountSection,
  security: SecuritySection,
  appearance: AppearanceSection,
  system: SystemSection,
}

const route = useRoute()
const auth = useAuthStore()
const store = usePreferencesStore()
const section = computed(() => findSection(route.params.section))

onMounted(() => {
  if (!store.saved) void store.load()
})

async function save() {
  if (await store.save()) notify('Settings saved')
  else notify(`Couldn't save your settings. ${store.error ?? ''}`.trim(), 'error')
}
</script>

<template>
  <TabPage name="settings">
    <v-row>
      <v-col cols="12" md="4" lg="3">
        <v-card class="d-none d-md-block pa-2 settings-nav" data-test="settings-nav">
          <v-list
            tag="ul"
            nav
            color="primary"
            density="comfortable"
            class="pa-0"
            aria-label="Settings sections"
          >
            <li v-for="(group, index) in settingsGroups" :key="group.title">
              <v-list-subheader
                :id="`settings-group-${index}`"
                class="settings-nav__group text-label-medium font-weight-bold"
                :class="{ 'mt-2': index > 0 }"
              >
                {{ group.title }}
              </v-list-subheader>
              <ul class="pa-0" :aria-labelledby="`settings-group-${index}`">
                <li v-for="item in group.sections" :key="item.key">
                  <v-list-item
                    :to="`/settings/${item.key}`"
                    :active="item.key === section.key"
                    :title="item.title"
                    rounded="lg"
                    class="mt-1"
                    :data-test="`settings-link-${item.key}`"
                  >
                    <template #prepend>
                      <v-icon :icon="item.icon" size="20" class="me-n2" />
                    </template>
                  </v-list-item>
                </li>
              </ul>
            </li>
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
      :visible="auth.isAdmin && store.dirty && !!store.saved"
      :saving="store.saving"
      @save="save"
      @discard="store.discard()"
    />
  </TabPage>
</template>

<style scoped>
.settings-nav {
  position: sticky;
  top: 96px;
}

.settings-nav__group {
  min-height: 32px;
  padding-inline-start: 12px !important;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
