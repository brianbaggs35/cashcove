<script setup lang="ts">
import { computed } from 'vue'

import { useElapsed } from '@/composables/useElapsed'

/**
 * What shows while the AI reads a statement, which can take a minute or two: what's happening,
 * how long it has been and what's kept private. It says more the longer the wait gets.
 */
defineProps<{ fileName: string; model: string | null }>()

const { seconds } = useElapsed()

const stage = computed(() => {
  if (seconds.value >= 60) return 'Still working. A slow model can take a few minutes.'
  if (seconds.value >= 15) return 'Still reading. A longer statement takes a little longer.'
  return 'Taking the transactions off the statement…'
})
</script>

<template>
  <div class="statement-progress" data-test="statement-progress">
    <div class="d-flex align-center ga-3">
      <v-progress-circular
        indeterminate
        size="22"
        width="3"
        color="primary"
        class="flex-shrink-0"
      />
      <div style="min-width: 0">
        <div class="text-title-small font-weight-bold text-break">Reading {{ fileName }}</div>
        <output class="d-block text-body-small text-medium-emphasis" data-test="statement-stage">
          {{ stage }}
        </output>
      </div>
    </div>
    <v-progress-linear
      indeterminate
      rounded
      height="4"
      color="primary"
      class="mt-3"
      aria-hidden="true"
    />
    <p class="text-body-small text-medium-emphasis mt-3 mb-0" data-test="statement-privacy">
      The PDF is read on this computer. Only its transaction lines go to {{ model ?? 'the AI' }},
      with names, numbers and addresses hidden.
    </p>
  </div>
</template>
