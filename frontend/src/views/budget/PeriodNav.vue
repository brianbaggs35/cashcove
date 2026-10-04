<script setup lang="ts">
import { CalendarClock, ChevronLeft, ChevronRight } from '@lucide/vue'
import type { RouteLocationRaw } from 'vue-router'

/**
 * Which period of a budget is being looked at, with links to the ones either side, and a way
 * back to the one the person is in.
 */
defineProps<{
  title: string
  /** Where the period is, e.g. how many days it has left. */
  subtitle?: string
  /** Where the periods either side are, which are null if there are none to look at. */
  previous: RouteLocationRaw | null
  next: RouteLocationRaw | null
  /** The period the person is in, and where to find it from another. */
  current: boolean
  back: RouteLocationRaw
  /** What to call the way back, e.g. "Back to this month". */
  backText: string
}>()
</script>

<template>
  <nav class="period-nav d-flex align-center ga-1" aria-label="Period" data-test="period-nav">
    <v-btn
      :icon="ChevronLeft"
      variant="text"
      aria-label="Previous period"
      :to="previous ?? undefined"
      :active="false"
      replace
      :disabled="!previous"
      data-test="period-previous"
    />
    <div class="period-nav__title flex-grow-1 text-center">
      <h2
        class="text-title-large font-weight-bold ma-0"
        aria-live="polite"
        data-test="period-title"
      >
        {{ title }}
      </h2>
      <p
        v-if="subtitle"
        class="text-body-small text-medium-emphasis ma-0"
        data-test="period-subtitle"
      >
        {{ subtitle }}
      </p>
    </div>
    <v-btn
      :icon="ChevronRight"
      variant="text"
      aria-label="Next period"
      :to="next ?? undefined"
      :active="false"
      replace
      :disabled="!next"
      data-test="period-next"
    />
    <v-btn
      v-if="!current"
      variant="tonal"
      color="primary"
      :prepend-icon="CalendarClock"
      :to="back"
      :active="false"
      replace
      class="period-nav__back ms-2 flex-shrink-0"
      data-test="period-back"
    >
      {{ backText }}
    </v-btn>
  </nav>
</template>

<style scoped>
.period-nav__title {
  min-width: 0;
}

@media (max-width: 600px) {
  .period-nav {
    flex-wrap: wrap;
    justify-content: center;
  }

  .period-nav__title {
    flex-basis: 0;
  }

  .period-nav__back {
    flex-basis: 100%;
    margin: 4px 0 0;
  }
}
</style>
