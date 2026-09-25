<script setup lang="ts">
import { computed } from 'vue'

import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { useAuthStore } from '@/stores/auth'
import { usePreferencesStore } from '@/stores/preferences'

// Shows the preference forms only once the draft has loaded, with loading and error states.
// Viewers see the same forms, read-only: the form makes every field inside it read-only, and
// `readonly` is passed on for controls a form doesn't reach, like button toggles.
const store = usePreferencesStore()
const auth = useAuthStore()
const readonly = computed(() => !auth.isAdmin)
</script>

<template>
  <v-form v-if="store.draft" :readonly="readonly" data-test="preferences-form" @submit.prevent>
    <ReadOnlyNotice v-if="readonly" />
    <slot :draft="store.draft" :readonly="readonly" />
  </v-form>
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
