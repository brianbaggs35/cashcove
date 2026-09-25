<script setup lang="ts">
import { Eye } from '@lucide/vue'

/** Tells viewers why they can't change something, instead of leaving controls mysteriously off. */
withDefaults(defineProps<{ text?: string }>(), {
  text: 'You can see these settings. Only an admin can change them.',
})
</script>

<template>
  <v-alert
    :icon="Eye"
    color="secondary"
    variant="tonal"
    density="compact"
    class="mb-6"
    data-test="read-only-notice"
  >
    {{ text }}
  </v-alert>
</template>
