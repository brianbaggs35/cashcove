<script setup lang="ts">
import { Check, Monitor, Moon, Palette, Paintbrush, Sun } from '@lucide/vue'
import { computed } from 'vue'
import { useTheme } from 'vuetify'

import { useThemeStore, type ThemePreference } from '@/stores/theme'
import { findPalette, PALETTES, type ThemeScheme } from '@/theme/palettes'
import SettingsCard from '@/views/settings/SettingsCard.vue'
import ThemePreview from '@/views/settings/ThemePreview.vue'

const store = useThemeStore()
const theme = useTheme()

const options: { value: ThemePreference; title: string; icon: typeof Sun }[] = [
  { value: 'light', title: 'Light', icon: Sun },
  { value: 'dark', title: 'Dark', icon: Moon },
  { value: 'system', title: 'Match device', icon: Monitor },
]

/** The colours being worn, which the light and dark previews show. */
const worn = computed(() => findPalette(store.palette))
/** Whether the app is dark right now, which the palettes are previewed in. */
const scheme = computed<ThemeScheme>(() => (theme.current.value.dark ? 'dark' : 'light'))

/** What a palette's main colours look like in the theme being worn. */
function swatches(palette: (typeof PALETTES)[number]): string[] {
  const colors = palette[scheme.value]
  return [colors.primary, colors.secondary, colors.accent]
}
</script>

<template>
  <SettingsCard
    title="Theme"
    subtitle="Saved on this device. Match device follows your system's light or dark setting."
    :icon="Sun"
  >
    <v-row>
      <v-col v-for="option in options" :key="option.value" cols="12" sm="4">
        <!-- A real button, so the keyboard reaches it and screen readers hear it's pressed. -->
        <v-card
          tag="button"
          type="button"
          :class="['appearance-option', `appearance-option--${option.value}`]"
          :color="store.preference === option.value ? 'primary' : undefined"
          :variant="store.preference === option.value ? 'tonal' : 'outlined'"
          :aria-pressed="store.preference === option.value"
          :data-test="`theme-option-${option.value}`"
          @click="store.setPreference(option.value)"
        >
          <span class="ma-3 d-block">
            <ThemePreview
              :palette="worn"
              :scheme="option.value === 'dark' ? 'dark' : 'light'"
              :against="option.value === 'system' ? 'dark' : undefined"
            />
          </span>
          <span class="d-flex align-center ga-2 px-4 pb-4">
            <v-icon :icon="option.icon" size="18" />
            <span class="text-label-large">{{ option.title }}</span>
            <v-icon
              v-if="store.preference === option.value"
              :icon="Check"
              size="18"
              class="ms-auto"
            />
          </span>
        </v-card>
      </v-col>
    </v-row>
  </SettingsCard>

  <SettingsCard
    title="Colors"
    subtitle="Saved on this device. Every color theme comes in a light and a dark version."
    :icon="Paintbrush"
  >
    <div class="palette-grid" role="group" aria-label="Color theme" data-test="palette-options">
      <v-card
        v-for="palette in PALETTES"
        :key="palette.id"
        tag="button"
        type="button"
        class="appearance-option"
        :color="store.palette === palette.id ? 'primary' : undefined"
        :variant="store.palette === palette.id ? 'tonal' : 'outlined'"
        :aria-pressed="store.palette === palette.id"
        :data-test="`palette-option-${palette.id}`"
        @click="store.setPalette(palette.id)"
      >
        <span class="ma-3 d-block">
          <ThemePreview :palette="palette" :scheme="scheme" />
        </span>
        <span class="d-flex align-center ga-2 px-4">
          <v-icon :icon="Palette" size="18" />
          <span class="text-label-large">{{ palette.title }}</span>
          <v-icon
            v-if="store.palette === palette.id"
            :icon="Check"
            size="18"
            class="ms-auto"
            data-test="palette-selected"
          />
        </span>
        <span class="d-flex align-center ga-2 px-4 pt-1 pb-4">
          <span class="d-flex ga-1" aria-hidden="true">
            <span
              v-for="color in swatches(palette)"
              :key="color"
              class="palette-swatch"
              :style="{ background: color }"
            />
          </span>
          <span class="text-body-small text-medium-emphasis">{{ palette.description }}</span>
        </span>
      </v-card>
    </div>
  </SettingsCard>
</template>

<style scoped>
.appearance-option {
  width: 100%;
  text-align: start;
}

.appearance-option.v-card--variant-outlined {
  border-color: rgba(var(--v-border-color), 0.2);
}

.palette-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
}

.palette-swatch {
  width: 14px;
  height: 14px;
  flex: none;
  border-radius: 50%;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
