<script setup lang="ts">
import { Settings, Sparkles } from '@lucide/vue'

import EmptyState from '@/components/ui/EmptyState.vue'
import { useAuthStore } from '@/stores/auth'

/**
 * What the AI tab shows until AI is set up. AI is optional: every other page works the same
 * without it, and this says so.
 */
const auth = useAuthStore()
</script>

<template>
  <v-card data-test="ai-setup">
    <EmptyState
      :icon="Sparkles"
      title="AI isn’t set up"
      text="It’s optional, and Cashcove works the same without it. With it, you can ask questions about your money and get a second opinion on how your transactions are sorted."
    >
      <v-btn
        v-if="auth.isAdmin"
        to="/settings/ai"
        color="primary"
        variant="flat"
        :prepend-icon="Settings"
        data-test="ai-setup-link"
      >
        Set up AI
      </v-btn>
      <p v-else class="text-body-medium text-medium-emphasis mb-0" data-test="ai-setup-viewer">
        An admin can choose an AI provider in Settings.
      </p>
    </EmptyState>
  </v-card>
</template>
