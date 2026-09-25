<script setup lang="ts">
import { usePreferencesStore } from '@/stores/preferences'

// Shows the preference forms only once the draft has loaded, with loading and error states.
const store = usePreferencesStore()
</script>

<template>
  <div v-if="store.draft">
    <slot :draft="store.draft" />
  </div>
  <v-alert
    v-else-if="store.error"
    type="error"
    variant="tonal"
    title="Couldn't load your settings"
    :text="store.error"
    data-test="preferences-error"
  >
    <template #append>
      <v-btn variant="text" data-test="preferences-retry" @click="store.load()">Try again</v-btn>
    </template>
  </v-alert>
  <v-card v-else class="pa-6" data-test="preferences-loading">
    <v-skeleton-loader type="heading, list-item-two-line@3" />
  </v-card>
</template>
