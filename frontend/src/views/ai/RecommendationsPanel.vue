<script setup lang="ts">
import { CircleCheck, CircleX, Hourglass, ListChecks, Sparkles, X } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  fetchAiReviews,
  fetchRecommendations,
  type AiReview,
  type RecommendationPage,
  type RecommendationStatus,
} from '@/api/ai'
import { errorMessage } from '@/api/client'
import EmptyState from '@/components/ui/EmptyState.vue'
import { notify } from '@/composables/notify'
import { useRecommendationActions } from '@/composables/useRecommendationActions'
import { useReviewProgress } from '@/composables/useReviewProgress'
import { useAiStore } from '@/stores/ai'
import { useCategoriesStore } from '@/stores/categories'
import { reviewActive, suggestionsOf } from '@/utils/ai'
import { formatCount } from '@/utils/format'
import RecommendationList from '@/views/ai/RecommendationList.vue'
import ReviewDialog from '@/views/ai/ReviewDialog.vue'
import ReviewHistory from '@/views/ai/ReviewHistory.vue'
import ReviewProgress from '@/views/ai/ReviewProgress.vue'

/**
 * Everything the AI has suggested, in one place: what's waiting for someone to decide, what was
 * applied or turned down, and each time it looked. Automations sort transactions first; this is
 * the AI's second opinion on what they got wrong, and nothing here changes until it's applied.
 */
const PAGE_SIZE = 20

const ai = useAiStore()
const categories = useCategoriesStore()
const route = useRoute()

const status = ref<RecommendationStatus>('open')
// A link from an import's last step shows the suggestions of that one review.
const reviewFilter = ref<string | null>(
  typeof route.query.review === 'string' ? route.query.review : null,
)
const page = ref(1)
const data = ref<RecommendationPage | null>(null)
const reviews = ref<AiReview[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const dialog = ref(false)
/** The review that's still going, which is followed until it's done. */
const following = ref<string | null>(null)

const items = computed(() => data.value?.items ?? [])
const counts = computed(() => data.value?.counts ?? { open: 0, applied: 0, dismissed: 0 })
const filteredReview = computed(() => reviews.value.find((item) => item.id === reviewFilter.value))
const confident = computed(() =>
  items.value.filter((item) => item.status === 'open' && item.confidence === 'high'),
)

const tiles = computed(() => [
  {
    key: 'open',
    label: 'Waiting for you',
    value: counts.value.open,
    icon: Hourglass,
    color: 'primary',
  },
  {
    key: 'applied',
    label: 'Applied',
    value: counts.value.applied,
    icon: CircleCheck,
    color: 'success',
  },
  {
    key: 'dismissed',
    label: 'Dismissed',
    value: counts.value.dismissed,
    icon: CircleX,
    color: 'secondary',
  },
])

async function loadList() {
  loading.value = true
  try {
    data.value = await fetchRecommendations({
      status: status.value,
      ...(reviewFilter.value ? { review_id: reviewFilter.value } : {}),
      page: page.value,
      page_size: PAGE_SIZE,
    })
    ai.counts = data.value.counts
    error.value = null
  } catch (loadError) {
    error.value = errorMessage(loadError)
  } finally {
    loading.value = false
  }
}

async function loadReviews() {
  try {
    reviews.value = await fetchAiReviews()
    following.value = reviews.value.find((item) => reviewActive(item.status))?.id ?? null
  } catch (loadError) {
    error.value = errorMessage(loadError)
  }
}

function reload() {
  return Promise.all([loadList(), loadReviews()])
}

function finished(review: AiReview) {
  const found = suggestionsOf(review)
  if (review.status === 'failed')
    notify(`The review stopped early. ${review.error ?? ''}`.trim(), 'error')
  else if (found) notify(`The AI has ${formatCount(found, 'suggestion')} for you to look at.`)
  else notify('The AI agrees with how those transactions are sorted.')
  void reload()
}

const progress = useReviewProgress(following, finished)

function started(review: AiReview) {
  reviews.value = [review, ...reviews.value]
  if (reviewActive(review.status)) {
    following.value = review.id
  } else {
    notify(
      'Nothing to review. Every transaction there either has a category someone chose, or has a suggestion waiting.',
      'info',
    )
  }
}

const { selected, decide } = useRecommendationActions(reload)

function showReview(review: AiReview) {
  reviewFilter.value = reviewFilter.value === review.id ? null : review.id
  status.value = review.open ? 'open' : status.value
}

watch([status, reviewFilter, page], () => {
  selected.value = []
  void loadList()
})
// A different filter starts at its first page.
watch([status, reviewFilter], () => {
  page.value = 1
})

onMounted(() => {
  void categories.ensureLoaded()
  void reload()
})
</script>

<template>
  <div data-test="ai-recommendations">
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-6"
      :text="`Couldn't load the suggestions. ${error}`"
      data-test="recommendations-error"
    >
      <template #append>
        <v-btn
          variant="text"
          size="small"
          :loading="loading"
          data-test="recommendations-retry"
          @click="reload()"
        >
          Try again
        </v-btn>
      </template>
    </v-alert>

    <v-row class="mb-2" density="compact">
      <v-col v-for="tile in tiles" :key="tile.key" cols="4">
        <v-card class="h-100" :data-test="`tile-${tile.key}`">
          <v-card-text class="pa-4">
            <div class="d-flex align-center ga-2 text-medium-emphasis mb-1">
              <v-icon :icon="tile.icon" size="18" :color="tile.color" />
              <span class="text-label-medium">{{ tile.label }}</span>
            </div>
            <div class="text-headline-small font-weight-bold tabular-nums">
              {{ tile.value.toLocaleString('en-US') }}
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-card
      v-if="
        progress.review.value &&
        (progress.active.value || progress.review.value.status === 'failed')
      "
      class="mb-6"
      data-test="active-review"
    >
      <v-card-text class="pa-5">
        <div class="d-flex align-center ga-2 mb-3">
          <v-icon :icon="Sparkles" size="20" class="text-medium-emphasis" />
          <h2 class="text-title-medium font-weight-bold ma-0">
            {{
              progress.review.value.source === 'import'
                ? 'Looking over your import'
                : 'Looking over your transactions'
            }}
          </h2>
        </div>
        <ReviewProgress :review="progress.review.value" />
      </v-card-text>
    </v-card>

    <v-card class="mb-6">
      <v-card-text class="pa-5">
        <header class="d-flex flex-wrap align-start ga-3 mb-4">
          <div class="flex-grow-1" style="min-width: 220px">
            <h2 class="text-title-medium font-weight-bold ma-0">Suggestions</h2>
            <p class="text-body-medium text-medium-emphasis ma-0 mt-1">
              Your automations sort transactions first. The AI gives a second opinion on what they
              got wrong. Nothing changes until you apply a suggestion.
            </p>
          </div>
          <v-btn
            v-if="ai.configured"
            color="primary"
            variant="flat"
            :prepend-icon="Sparkles"
            :disabled="progress.active.value"
            data-test="review-open"
            @click="dialog = true"
          >
            Review transactions
          </v-btn>
        </header>

        <div class="d-flex flex-wrap align-center ga-3 mb-2">
          <v-btn-toggle
            v-model="status"
            mandatory
            divided
            variant="outlined"
            color="primary"
            density="comfortable"
            aria-label="Which suggestions"
            data-test="recommendation-status"
          >
            <v-btn value="open" size="small">Waiting ({{ counts.open }})</v-btn>
            <v-btn value="applied" size="small">Applied ({{ counts.applied }})</v-btn>
            <v-btn value="dismissed" size="small">Dismissed ({{ counts.dismissed }})</v-btn>
          </v-btn-toggle>
          <v-chip
            v-if="reviewFilter"
            closable
            variant="tonal"
            color="primary"
            data-test="review-filter"
            @click:close="reviewFilter = null"
          >
            One review{{ filteredReview?.file_name ? `: ${filteredReview.file_name}` : '' }}
          </v-chip>
          <v-spacer />
          <template v-if="status === 'open' && items.length">
            <template v-if="selected.length">
              <v-btn
                color="primary"
                variant="tonal"
                size="small"
                :loading="decide.busy.value"
                data-test="apply-selected"
                @click="decide.run('apply', selected)"
              >
                Apply {{ selected.length }}
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                :prepend-icon="X"
                :disabled="decide.busy.value"
                data-test="dismiss-selected"
                @click="decide.run('dismiss', selected)"
              >
                Dismiss {{ selected.length }}
              </v-btn>
            </template>
            <v-btn
              v-else
              variant="text"
              size="small"
              :disabled="!confident.length"
              data-test="select-confident"
              @click="selected = confident.map((item) => item.id)"
            >
              Select the high-confidence ones
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
          data-test="decide-error"
        />

        <div v-if="!data && loading" data-test="recommendations-loading">
          <v-skeleton-loader type="list-item-three-line@3" />
        </div>
        <template v-else-if="data?.items.length">
          <RecommendationList
            v-model="selected"
            :items="data.items"
            :busy="decide.busy.value"
            @apply="decide.run('apply', $event)"
            @dismiss="decide.run('dismiss', $event)"
          />
          <v-pagination
            v-if="data.total > PAGE_SIZE"
            v-model="page"
            :length="Math.ceil(data.total / PAGE_SIZE)"
            :total-visible="5"
            density="comfortable"
            class="mt-4"
            data-test="recommendation-pages"
          />
        </template>
        <EmptyState
          v-else-if="data"
          compact
          :icon="ListChecks"
          :title="
            status === 'open'
              ? reviews.length
                ? 'Nothing waiting'
                : 'No suggestions yet'
              : 'Nothing here yet'
          "
          :text="
            status === 'open'
              ? reviews.length
                ? 'The AI agrees with how your transactions are sorted. When it finds something it would change, it shows up here.'
                : 'Once the AI has looked over your transactions, what it would change shows up here. Import a file, or ask for a review.'
              : `Suggestions you ${status === 'applied' ? 'apply' : 'dismiss'} are kept here.`
          "
          data-test="recommendations-empty"
        >
          <v-btn
            v-if="status === 'open' && ai.configured"
            color="primary"
            variant="tonal"
            :prepend-icon="Sparkles"
            :disabled="progress.active.value"
            data-test="review-empty-open"
            @click="dialog = true"
          >
            Review transactions
          </v-btn>
          <v-btn
            v-else-if="status === 'open' && !ai.configured"
            to="/settings/ai"
            variant="tonal"
            data-test="recommendations-setup"
          >
            Set up AI
          </v-btn>
        </EmptyState>
      </v-card-text>
    </v-card>

    <v-card v-if="reviews.length" class="mb-6">
      <v-card-text class="pa-5">
        <h2 class="text-title-medium font-weight-bold ma-0 mb-1">When the AI looked</h2>
        <ReviewHistory :reviews="reviews" :selected="reviewFilter" @show="showReview" />
      </v-card-text>
    </v-card>

    <ReviewDialog v-model="dialog" @started="started" />
  </div>
</template>
