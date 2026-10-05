<script setup lang="ts">
import { Compass } from '@lucide/vue'
</script>

<template>
  <v-empty-state
    :icon="Compass"
    headline="Page not found"
    text="That page doesn't exist. Head back to your dashboard."
  >
    <template #actions>
      <v-btn color="primary" to="/dashboard" variant="flat">Go to Dashboard</v-btn>
    </template>
  </v-empty-state>
</template>
