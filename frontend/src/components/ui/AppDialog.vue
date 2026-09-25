<script setup lang="ts">
import { X, type LucideIcon } from '@lucide/vue'
import { useDisplay } from 'vuetify'

/**
 * The one dialog frame every Cashcove dialog uses: an icon, a title and short explanation,
 * the content, then actions. Full screen on phones when there's a form to fill in.
 */
withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    icon?: LucideIcon
    tone?: 'primary' | 'error' | 'warning' | 'success' | 'secondary'
    maxWidth?: number | string
    /** Full screen on small screens, for dialogs with forms or long content. */
    fullscreenOnMobile?: boolean
    /** Blocks closing by clicking outside or pressing Escape, e.g. while saving. */
    persistent?: boolean
    closable?: boolean
  }>(),
  {
    subtitle: undefined,
    icon: undefined,
    tone: 'primary',
    maxWidth: 520,
    fullscreenOnMobile: false,
    persistent: false,
    closable: true,
  },
)

const open = defineModel<boolean>({ required: true })
const { xs } = useDisplay()
</script>

<template>
  <v-dialog
    v-model="open"
    :max-width="maxWidth"
    :fullscreen="fullscreenOnMobile && xs"
    :persistent="persistent"
    scrollable
  >
    <v-card class="app-dialog" :rounded="fullscreenOnMobile && xs ? 0 : 'xl'">
      <div class="app-dialog__header d-flex align-start ga-4 px-6 pt-6 pb-3">
        <v-avatar v-if="icon" :color="tone" variant="tonal" rounded="lg" size="44">
          <v-icon :icon="icon" size="22" />
        </v-avatar>
        <div class="flex-grow-1" style="min-width: 0">
          <h2 class="text-title-large font-weight-bold ma-0">{{ title }}</h2>
          <p v-if="subtitle" class="text-body-medium text-medium-emphasis mt-1 mb-0">
            {{ subtitle }}
          </p>
        </div>
        <v-btn
          v-if="closable"
          :icon="X"
          variant="text"
          size="small"
          class="mt-n1 me-n2"
          aria-label="Close"
          :disabled="persistent"
          data-test="dialog-close"
          @click="open = false"
        />
      </div>
      <v-card-text class="px-6 pt-3 pb-2">
        <slot />
      </v-card-text>
      <v-card-actions v-if="$slots.actions" class="app-dialog__actions px-6 pt-3 pb-5">
        <slot name="actions" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.app-dialog__actions {
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
