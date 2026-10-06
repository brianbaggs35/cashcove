<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'

import type { AiReview } from '@/api/ai'
import { reviewActive } from '@/utils/ai'
import { formatCount } from '@/utils/format'

/** How far a review has got while it runs, or why it stopped. A finished one shows nothing. */
const props = defineProps<{ review: AiReview }>()

const active = computed(() => reviewActive(props.review.status))
const percent = computed(() =>
  props.review.total ? Math.round((props.review.reviewed / props.review.total) * 100) : 0,
)
const text = computed(() =>
  props.review.status === 'pending'
    ? `Getting ready to look over ${formatCount(props.review.total, 'transaction')}…`
    : `Reviewed ${props.review.reviewed.toLocaleString('en-US')} of ${formatCount(props.review.total, 'transaction')}…`,
)
</script>

<template>
  <div v-if="active" data-test="review-progress">
    <v-progress-linear
      :model-value="percent"
      :indeterminate="review.status === 'pending'"
      color="primary"
      rounded
      height="6"
      aria-label="Review progress"
    />
    <output class="d-block text-body-medium text-medium-emphasis mt-2">{{ text }}</output>
  </div>
  <v-alert
    v-else-if="review.status === 'failed'"
    type="warning"
    variant="tonal"
    density="compact"
    :icon="TriangleAlert"
    data-test="review-failed"
  >
    <div class="font-weight-medium">The review stopped early.</div>
    <div>{{ review.error }}</div>
    <div v-if="review.reviewed" class="mt-1">
      It had looked at {{ review.reviewed.toLocaleString('en-US') }} of
      {{ review.total.toLocaleString('en-US') }} first.
    </div>
  </v-alert>
</template>
