<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue'
import { useDisplay } from 'vuetify'

/**
 * A settings panel: an icon, title and explanation, then its content. `append` holds something
 * small beside the title, like a status chip; `action` holds the panel's main button, which
 * moves under the explanation on phones so the text keeps its width.
 */
defineProps<{ title: string; subtitle?: string; icon?: LucideIcon }>()
const { xs } = useDisplay()
</script>

<template>
  <v-card class="settings-card mb-6">
    <v-card-item class="pt-5 px-5 px-md-6">
      <template v-if="icon" #prepend>
        <v-avatar color="primary" variant="tonal" rounded="lg" size="40">
          <v-icon :icon="icon" size="20" />
        </v-avatar>
      </template>
      <v-card-title class="text-title-medium font-weight-bold">{{ title }}</v-card-title>
      <v-card-subtitle v-if="subtitle" class="settings-card__subtitle">
        {{ subtitle }}
      </v-card-subtitle>
      <template v-if="$slots.append || ($slots.action && !xs)" #append>
        <div class="d-flex align-center ga-2">
          <slot name="append" />
          <slot v-if="!xs" name="action" />
        </div>
      </template>
    </v-card-item>
    <v-card-text class="px-5 px-md-6 pb-6">
      <div v-if="$slots.action && xs" class="mb-4" data-test="settings-card-action">
        <slot name="action" />
      </div>
      <slot />
    </v-card-text>
  </v-card>
</template>

<style scoped>
.settings-card__subtitle {
  white-space: normal;
}
</style>
