<script setup lang="ts">
import { Check, CircleCheck, X } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import { fetchRecommendations, type RecommendationPage } from '@/api/ai'
import { errorMessage } from '@/api/client'
import { useRecommendationActions } from '@/composables/useRecommendationActions'
import { useReviewProgress } from '@/composables/useReviewProgress'
import { useCategoriesStore } from '@/stores/categories'
import { agreementWith, suggestionsOf } from '@/utils/ai'
import { formatCount } from '@/utils/format'
import RecommendationList from '@/views/ai/RecommendationList.vue'
import ReviewProgress from '@/views/ai/ReviewProgress.vue'

/**
 * The step after an import, when AI is set up: what the automations did, then the AI's second
 * opinion on it, as it arrives. The suggestions can be applied or turned down right here, or
 * left for the AI tab, where they wait.
 */
const props = defineProps<{ reviewId: string; notes: string[] }>()
const emit = defineEmits<{ finished: [] }>()

/** The most suggestions listed here; the AI tab has them all. */
const LIMIT = 50

const categories = useCategoriesStore()
const page = ref<RecommendationPage | null>(null)
const error = ref<string | null>(null)

async function loadList() {
  try {
    page.value = await fetchRecommendations({
      review_id: props.reviewId,
      status: 'open',
      page_size: LIMIT,
    })
    error.value = null
  } catch (loadError) {
    error.value = errorMessage(loadError)
  }
}

const { selected, decide } = useRecommendationActions(loadList)
const progress = useReviewProgress(
  () => props.reviewId,
  () => {
    void loadList()
    emit('finished')
  },
)

const review = computed(() => progress.review.value)
const items = computed(() => page.value?.items ?? [])
const everyId = computed(() => items.value.map((item) => item.id))

onMounted(() => void categories.ensureLoaded())
</script>

<template>
  <div data-test="import-ai">
    <v-alert
      type="success"
      variant="tonal"
      density="compact"
      class="mb-5"
      data-test="import-ai-notes"
    >
      <div v-for="note in notes" :key="note">{{ note }}</div>
    </v-alert>

    <v-alert
      v-if="progress.error.value && !review"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="`Couldn't check on the AI. ${progress.error.value}`"
      data-test="import-ai-error"
    />

    <ReviewProgress v-if="review" :review="review" class="mb-4" />
    <p
      v-if="review && (review.status === 'pending' || review.status === 'running')"
      class="text-body-small text-medium-emphasis"
      data-test="import-ai-wait"
    >
      You can close this. The suggestions wait for you on the AI tab.
    </p>

    <template v-if="review?.status === 'done'">
      <v-alert
        v-if="!suggestionsOf(review)"
        type="success"
        variant="tonal"
        density="compact"
        :icon="CircleCheck"
        data-test="import-ai-agrees"
      >
        {{ agreementWith(review.total) }}
      </v-alert>

      <v-alert
        v-else-if="!items.length && page"
        type="success"
        variant="tonal"
        density="compact"
        :icon="CircleCheck"
        data-test="import-ai-decided"
      >
        You’ve been through everything the AI suggested.
      </v-alert>

      <template v-else-if="items.length">
        <div class="d-flex flex-wrap align-center ga-2 mb-2">
          <p class="text-body-medium flex-grow-1 ma-0" data-test="import-ai-summary">
            The AI has {{ formatCount(suggestionsOf(review), 'suggestion') }} for how these were
            sorted. Nothing changes until you apply one.
          </p>
          <template v-if="selected.length">
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              :prepend-icon="Check"
              :loading="decide.busy.value"
              data-test="import-ai-apply-selected"
              @click="decide.run('apply', selected)"
            >
              Apply {{ selected.length }}
            </v-btn>
            <v-btn
              variant="text"
              size="small"
              :prepend-icon="X"
              :disabled="decide.busy.value"
              data-test="import-ai-dismiss-selected"
              @click="decide.run('dismiss', selected)"
            >
              Dismiss {{ selected.length }}
            </v-btn>
          </template>
          <template v-else>
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              :prepend-icon="Check"
              :loading="decide.busy.value"
              data-test="import-ai-apply-all"
              @click="decide.run('apply', everyId)"
            >
              Apply all {{ items.length }}
            </v-btn>
            <v-btn
              variant="text"
              size="small"
              :prepend-icon="X"
              :disabled="decide.busy.value"
              data-test="import-ai-dismiss-all"
              @click="decide.run('dismiss', everyId)"
            >
              Dismiss all
            </v-btn>
          </template>
        </div>
        <v-alert
          v-if="decide.error.value"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-2"
          :text="decide.error.value"
          data-test="import-ai-decide-error"
        />
        <RecommendationList
          v-model="selected"
          :items="items"
          :busy="decide.busy.value"
          @apply="decide.run('apply', $event)"
          @dismiss="decide.run('dismiss', $event)"
        />
        <p
          v-if="page && page.total > items.length"
          class="text-body-small text-medium-emphasis mt-3 mb-0"
          data-test="import-ai-more"
        >
          Showing the first {{ items.length }} of {{ page.total.toLocaleString('en-US') }}.
          <router-link :to="{ path: '/ai/recommendations', query: { review: reviewId } }">
            See them all on the AI tab
          </router-link>
        </p>
      </template>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-3"
        :text="`Couldn't load the suggestions. ${error}`"
        data-test="import-ai-load-error"
      />
    </template>
  </div>
</template>
