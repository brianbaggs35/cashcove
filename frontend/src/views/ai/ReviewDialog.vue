<script setup lang="ts">
import { Sparkles } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { startAiReview, type AiReview } from '@/api/ai'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useAction } from '@/composables/useAction'
import { useAiStore } from '@/stores/ai'
import { todayIso } from '@/utils/dates'
import { formatCount } from '@/utils/format'
import AiPrivacyNotice from '@/views/ai/AiPrivacyNotice.vue'

/**
 * Asks the AI for a second opinion on transactions nobody chose a category for, which it gives
 * after this closes: the suggestions show on the page as it finishes.
 */
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ started: [review: AiReview] }>()

/** How many transactions go in one request to the AI. */
const BATCH = 40

const ai = useAiStore()
const scope = ref<'recent' | 'uncategorized'>('recent')
const days = ref(30)
const limit = ref(50)

const dayOptions = [
  { value: 7, title: 'Last 7 days' },
  { value: 14, title: 'Last 14 days' },
  { value: 30, title: 'Last 30 days' },
  { value: 90, title: 'Last 90 days' },
  { value: 180, title: 'Last 6 months' },
  { value: 365, title: 'Last year' },
]
const limitOptions = [25, 50, 100, 200].map((value) => ({
  value,
  title: `The newest ${value}`,
}))

const requests = computed(() => Math.ceil(limit.value / BATCH))

const start = useAction(async () => {
  const review = await startAiReview({
    scope: scope.value,
    days: days.value,
    limit: limit.value,
    today: todayIso(),
  })
  open.value = false
  emit('started', review)
})

watch(open, (value) => {
  if (value) start.clear()
})
</script>

<template>
  <AppDialog
    v-model="open"
    title="Review transactions"
    subtitle="The AI looks over how your transactions are sorted and suggests changes. Nothing changes until you accept."
    :icon="Sparkles"
    max-width="560"
    fullscreen-on-mobile
    :persistent="start.busy.value"
  >
    <div class="text-label-large mb-2">Which transactions</div>
    <v-btn-toggle
      v-model="scope"
      mandatory
      divided
      variant="outlined"
      color="primary"
      density="comfortable"
      class="mb-4"
      data-test="review-scope"
    >
      <v-btn value="recent">Recent ones</v-btn>
      <v-btn value="uncategorized">Only uncategorized</v-btn>
    </v-btn-toggle>

    <v-row>
      <v-col v-if="scope === 'recent'" cols="12" sm="6">
        <v-select
          v-model="days"
          :items="dayOptions"
          label="From"
          hide-details
          data-test="review-days"
        />
      </v-col>
      <v-col cols="12" :sm="scope === 'recent' ? 6 : 12">
        <v-select
          v-model="limit"
          :items="limitOptions"
          label="How many"
          hide-details
          data-test="review-limit"
        />
      </v-col>
    </v-row>

    <p class="text-body-medium text-medium-emphasis mt-4 mb-4" data-test="review-explain">
      It looks at transactions nobody chose a category for, uncategorized ones first. A category you
      chose yourself is never reviewed. That’s about
      {{ formatCount(requests, 'request') }} to {{ ai.modelName }}.
    </p>

    <AiPrivacyNotice />

    <v-alert
      v-if="start.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-4"
      :text="start.error.value"
      data-test="review-error"
    />

    <template #actions>
      <v-btn
        variant="text"
        :disabled="start.busy.value"
        data-test="review-cancel"
        @click="open = false"
      >
        Cancel
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Sparkles"
        :loading="start.busy.value"
        data-test="review-start"
        @click="start.run()"
      >
        Start review
      </v-btn>
    </template>
  </AppDialog>
</template>
