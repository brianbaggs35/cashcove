<script setup lang="ts">
import { computed } from 'vue'

import { useElapsed } from '@/composables/useElapsed'

/**
 * What shows while the AI works on something short: what it's doing, a say about how long it has
 * been when it takes a while, and what stays private. It sits where the answer will be, so the
 * page is never left looking as if nothing is happening.
 */
const props = defineProps<{
  /** What it's doing, in a few words, e.g. "Working out the filters…". */
  working: string
  /** What is kept from the AI, said where the person is waiting. */
  privacy: string
}>()

const { seconds } = useElapsed()

const stage = computed(() => {
  if (seconds.value >= 60) return 'Still working. A slow model can take a few minutes.'
  if (seconds.value >= 15) return 'Still working. A slower model takes a little longer.'
  return props.working
})
</script>

<template>
  <div class="ai-progress" data-test="ai-progress">
    <div class="d-flex align-center ga-3">
      <v-progress-circular
        indeterminate
        size="20"
        width="3"
        color="primary"
        class="flex-shrink-0"
        aria-hidden="true"
      />
      <output class="text-body-medium" data-test="ai-progress-stage">{{ stage }}</output>
    </div>
    <v-progress-linear
      indeterminate
      rounded
      height="4"
      color="primary"
      class="mt-3"
      aria-hidden="true"
    />
    <p class="text-body-small text-medium-emphasis mt-3 mb-0" data-test="ai-progress-privacy">
      {{ privacy }}
    </p>
  </div>
</template>
