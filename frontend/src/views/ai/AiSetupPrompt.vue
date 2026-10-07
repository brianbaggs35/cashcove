<script setup lang="ts">
import {
  FileText,
  ListChecks,
  MessageCircleQuestion,
  Search,
  Settings,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from '@lucide/vue'

import { useAuthStore } from '@/stores/auth'

/**
 * What the AI tab shows until AI is set up. AI is optional: every other page works the same
 * without it, and this says so, and what the AI tab can do once it's on.
 */
const auth = useAuthStore()

const features: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: MessageCircleQuestion,
    title: 'Ask about your money',
    text: 'Spending, income, budgets, subscriptions and bills, answered in plain words from your own records.',
  },
  {
    icon: FileText,
    title: 'Read a PDF statement',
    text: 'The AI takes the transactions off it, and you check them and choose the account before anything is added.',
  },
  {
    icon: ListChecks,
    title: 'A second opinion on sorting',
    text: 'It looks over how your transactions are sorted and suggests changes. Nothing changes until you apply one.',
  },
  {
    icon: Search,
    title: 'Find transactions in your own words',
    text: 'Describe what you’re after, like “groceries over $50 last month”, and it becomes filters you can change.',
  },
  {
    icon: WandSparkles,
    title: 'Suggest automations',
    text: 'It notices the categories you keep choosing by hand and suggests automations for them, which you check before they’re made.',
  },
]
</script>

<template>
  <v-card class="pa-6 pa-md-8" data-test="ai-setup">
    <div class="ai-setup__head text-center mx-auto">
      <div class="ai-setup__mark mx-auto mb-4"><v-icon :icon="Sparkles" size="30" /></div>
      <h2 class="text-title-large font-weight-bold mb-1">AI isn’t set up</h2>
      <p class="text-body-medium text-medium-emphasis mb-0">
        It’s optional, and Cashcove works the same without it. Account numbers, account names and
        bank names are never sent to an AI.
      </p>
    </div>

    <v-row class="mt-6" data-test="ai-setup-features">
      <v-col v-for="feature in features" :key="feature.title" cols="12" md="4">
        <v-sheet border rounded="lg" class="ai-setup__feature pa-4 h-100">
          <div class="d-flex align-center ga-2 mb-2">
            <v-avatar color="primary" variant="tonal" rounded="lg" size="36">
              <v-icon :icon="feature.icon" size="20" />
            </v-avatar>
            <v-chip size="x-small" variant="tonal" label>Needs AI</v-chip>
          </div>
          <p class="text-title-small font-weight-bold mb-1">{{ feature.title }}</p>
          <p class="text-body-small text-medium-emphasis mb-0">{{ feature.text }}</p>
        </v-sheet>
      </v-col>
    </v-row>

    <div class="text-center mt-6">
      <p class="text-body-medium mb-4" data-test="ai-setup-needs">
        These can only be used with AI.
      </p>
      <v-btn
        v-if="auth.isAdmin"
        to="/settings/ai"
        color="primary"
        variant="flat"
        size="large"
        :prepend-icon="Settings"
        data-test="ai-setup-link"
      >
        Set up AI
      </v-btn>
      <p v-else class="text-body-medium text-medium-emphasis mb-0" data-test="ai-setup-viewer">
        An admin can choose an AI provider in Settings.
      </p>
    </div>
  </v-card>
</template>

<style scoped>
.ai-setup__head {
  max-width: 560px;
}

.ai-setup__mark {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  border-radius: 20px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
}
</style>
