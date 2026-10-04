<script setup lang="ts">
import { Repeat, Tags, Trash2, WandSparkles, X } from '@lucide/vue'

/**
 * What an admin can do with the transactions they've selected. `payments` is how many of them
 * are money going out, which are the ones a subscription can be linked to.
 */
defineProps<{ count: number; payments: number }>()
const emit = defineEmits<{ categorize: []; link: []; automate: []; delete: []; clear: [] }>()
</script>

<template>
  <div class="bulk-bar d-flex flex-wrap align-center ga-2 px-4 py-2" data-test="bulk-bar">
    <span class="text-title-small font-weight-bold" aria-live="polite"> {{ count }} selected </span>
    <v-spacer />
    <v-btn
      variant="text"
      :prepend-icon="Tags"
      data-test="bulk-categorize"
      @click="emit('categorize')"
    >
      Categorize
    </v-btn>
    <v-btn
      variant="text"
      :prepend-icon="Repeat"
      :disabled="!payments"
      data-test="bulk-link"
      @click="emit('link')"
    >
      Link to subscription
    </v-btn>
    <v-btn
      variant="text"
      :prepend-icon="WandSparkles"
      data-test="bulk-automate"
      @click="emit('automate')"
    >
      Automate
    </v-btn>
    <v-btn
      variant="text"
      color="error"
      :prepend-icon="Trash2"
      data-test="bulk-delete"
      @click="emit('delete')"
    >
      Delete
    </v-btn>
    <v-btn
      :icon="X"
      variant="text"
      size="small"
      aria-label="Clear selection"
      data-test="bulk-clear"
      @click="emit('clear')"
    />
  </div>
</template>

<style scoped>
.bulk-bar {
  background: rgba(var(--v-theme-primary), 0.08);
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.2);
}
</style>
