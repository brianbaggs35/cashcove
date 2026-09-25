<script setup lang="ts">
import { ExternalLink, TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'

import { useAuthStore } from '@/stores/auth'

// Cashcove only accepts changes, and passkeys only work, at the address it's set up for.
const auth = useAuthStore()
const here = computed(() => `${auth.origin}${window.location.pathname}${window.location.search}`)
</script>

<template>
  <v-alert
    v-if="auth.wrongOrigin"
    type="warning"
    variant="tonal"
    :icon="TriangleAlert"
    rounded="0"
    class="origin-notice"
    data-test="origin-notice"
  >
    Cashcove is set up for <strong>{{ auth.origin }}</strong
    >. Open it there to sign in and make changes.
    <template #append>
      <v-btn :href="here" :append-icon="ExternalLink" variant="text" size="small">Open</v-btn>
    </template>
  </v-alert>
</template>
