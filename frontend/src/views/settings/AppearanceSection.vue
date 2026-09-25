<script setup lang="ts">
import { Check, Monitor, Moon, Palette, Sun } from '@lucide/vue'

import { useThemeStore, type ThemePreference } from '@/stores/theme'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const store = useThemeStore()

const options: { value: ThemePreference; title: string; icon: typeof Sun }[] = [
  { value: 'light', title: 'Light', icon: Sun },
  { value: 'dark', title: 'Dark', icon: Moon },
  { value: 'system', title: 'Match device', icon: Monitor },
]
</script>

<template>
  <SettingsCard
    title="Theme"
    subtitle="Saved on this device. Match device follows your system's light or dark setting."
    :icon="Palette"
  >
    <v-row>
      <v-col v-for="option in options" :key="option.value" cols="12" sm="4">
        <v-card
          :class="['theme-option', `theme-option--${option.value}`]"
          :color="store.preference === option.value ? 'primary' : undefined"
          :variant="store.preference === option.value ? 'tonal' : 'outlined'"
          :aria-pressed="store.preference === option.value"
          :data-test="`theme-option-${option.value}`"
          @click="store.setPreference(option.value)"
        >
          <div class="theme-option__preview ma-3" aria-hidden="true">
            <div class="theme-option__side" />
            <div class="theme-option__body">
              <div class="theme-option__bar" />
              <div class="theme-option__line" />
              <div class="theme-option__line short" />
            </div>
          </div>
          <div class="d-flex align-center ga-2 px-4 pb-4">
            <v-icon :icon="option.icon" size="18" />
            <span class="text-label-large">{{ option.title }}</span>
            <v-spacer />
            <v-icon v-if="store.preference === option.value" :icon="Check" size="18" />
          </div>
        </v-card>
      </v-col>
    </v-row>
  </SettingsCard>
</template>

<style scoped>
.theme-option.v-card--variant-outlined {
  border-color: rgba(var(--v-border-color), 0.2);
}

.theme-option__preview {
  --bg: #f5f7fa;
  --panel: #ffffff;
  --ink: #cbd5e1;
  --accent: #0d9488;
  display: flex;
  height: 96px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.theme-option--dark .theme-option.v-card--variant-outlined {
  border-color: rgba(var(--v-border-color), 0.2);
}

.theme-option__preview {
  --bg: #0b1120;
  --panel: #111a2e;
  --ink: #334155;
  --accent: #2dd4bf;
}

.theme-option--system .theme-option__preview {
  background: linear-gradient(135deg, #f5f7fa 50%, #0b1120 50%);
}

.theme-option__side {
  width: 28%;
  background: var(--panel);
}

.theme-option__body {
  flex: 1;
  padding: 12px;
}

.theme-option__bar {
  height: 10px;
  width: 50%;
  border-radius: 5px;
  background: var(--accent);
  margin-bottom: 10px;
}

.theme-option__line {
  height: 8px;
  border-radius: 4px;
  background: var(--ink);
  margin-bottom: 8px;
}

.theme-option__line.short {
  width: 60%;
}
</style>
