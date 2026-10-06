<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useDisplay } from 'vuetify'

import TabPage from '@/components/TabPage.vue'
import { useAiStore } from '@/stores/ai'
import AiSetupPrompt from '@/views/ai/AiSetupPrompt.vue'
import ChatPanel from '@/views/ai/ChatPanel.vue'
import RecommendationsPanel from '@/views/ai/RecommendationsPanel.vue'
import { aiSections, findAiSection } from '@/views/ai/sections'
import UsagePanel from '@/views/ai/UsagePanel.vue'

/**
 * The AI tab: asking questions about the household's money, the AI's second opinions on how its
 * transactions are sorted, and what it all costs. AI is optional, so every page says what's
 * missing until it's set up, and nothing else in Cashcove depends on it.
 */
const route = useRoute()
const ai = useAiStore()
const { xs } = useDisplay()

const section = computed(() => findAiSection(route.params.section))
const waiting = computed(() => ai.counts?.open ?? 0)

onMounted(() => {
  void ai.ensureLoaded()
  void ai.loadCounts()
})
</script>

<template>
  <TabPage name="ai">
    <v-tabs
      :model-value="section.key"
      color="primary"
      show-arrows
      class="mb-6"
      aria-label="AI pages"
      data-test="ai-tabs"
    >
      <v-tab
        v-for="item in aiSections"
        :key="item.key"
        :value="item.key"
        :to="item.to"
        exact
        :prepend-icon="xs ? undefined : item.icon"
        :data-test="`ai-tab-${item.key}`"
      >
        {{ item.title }}
        <v-badge
          v-if="item.key === 'recommendations' && waiting"
          :content="waiting"
          color="primary"
          inline
          data-test="ai-tab-waiting"
        >
          <span class="d-sr-only">{{ waiting }} waiting</span>
        </v-badge>
      </v-tab>
    </v-tabs>

    <v-alert
      v-if="ai.error && !ai.loaded"
      type="error"
      variant="tonal"
      :text="`Couldn't load the AI settings. ${ai.error}`"
      data-test="ai-error"
    >
      <template #append>
        <v-btn
          variant="text"
          size="small"
          :loading="ai.loading"
          data-test="ai-retry"
          @click="ai.load()"
        >
          Try again
        </v-btn>
      </template>
    </v-alert>

    <v-skeleton-loader
      v-else-if="!ai.loaded"
      type="heading, text, text"
      class="rounded-xl"
      data-test="ai-loading"
    />

    <template v-else>
      <template v-if="section.key === 'ask'">
        <AiSetupPrompt v-if="!ai.configured" />
        <ChatPanel v-else />
      </template>
      <RecommendationsPanel v-else-if="section.key === 'recommendations'" />
      <UsagePanel v-else />
    </template>
  </TabPage>
</template>
