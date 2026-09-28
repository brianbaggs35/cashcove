<script setup lang="ts">
/** Where a dialog that goes step by step is up to: the steps done, the current one, and what's next. */
defineProps<{
  steps: readonly string[]
  /** The current step, counted from 0. */
  current: number
  /** Every step is done. */
  done?: boolean
}>()
</script>

<template>
  <ol class="step-list d-flex ga-2 pa-0" aria-label="Steps" data-test="step-list">
    <li
      v-for="(label, index) in steps"
      :key="label"
      class="step-list__step d-flex align-center ga-2 flex-grow-1"
      :class="{
        'step-list__step--done': index < current || done,
        'step-list__step--current': index === current && !done,
      }"
      :aria-current="index === current && !done ? 'step' : undefined"
    >
      <span class="step-list__number" aria-hidden="true">{{ index + 1 }}</span>
      <span class="text-label-medium">{{ label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.step-list {
  list-style: none;
}

.step-list__step {
  min-width: 0;
  padding-bottom: 10px;
  border-bottom: 3px solid rgba(var(--v-border-color), var(--v-border-opacity));
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.step-list__number {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 700;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.step-list__step--current,
.step-list__step--done {
  color: rgb(var(--v-theme-on-surface));
  border-bottom-color: rgb(var(--v-theme-primary));
}

.step-list__step--current .step-list__number,
.step-list__step--done .step-list__number {
  color: rgb(var(--v-theme-on-primary));
  background: rgb(var(--v-theme-primary));
}
</style>
