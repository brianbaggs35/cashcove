<script setup lang="ts">
import { computed } from 'vue'

import { formatMoney } from '@/utils/format'
import { fromCents, toCents } from '@/utils/money'

const props = withDefaults(
  defineProps<{
    label: string
    used: string
    limit: string
    currency: string
    usedLabel?: string
    targetLabel?: string
    thresholdPercent?: number
  }>(),
  { usedLabel: 'Used', targetLabel: 'target', thresholdPercent: 90 },
)

const usedCents = computed(() => Math.max(0, toCents(props.used)))
const limitCents = computed(() => Math.max(0, toCents(props.limit)))
const percent = computed(() => (limitCents.value ? (usedCents.value / limitCents.value) * 100 : 0))
const roundedPercent = computed(() => Math.round(percent.value))
const progress = computed(() => Math.min(100, roundedPercent.value))
const over = computed(() => limitCents.value > 0 && usedCents.value > limitCents.value)
const near = computed(
  () => limitCents.value > 0 && !over.value && percent.value >= props.thresholdPercent,
)
const color = computed(() => {
  if (over.value) return 'error'
  if (near.value) return 'warning'
  return 'primary'
})
const remaining = computed(() => Math.max(0, limitCents.value - usedCents.value))
const difference = computed(() =>
  fromCents(over.value ? usedCents.value - limitCents.value : remaining.value),
)
</script>

<template>
  <section
    class="budget-progress"
    :data-test="`progress-${label.toLowerCase().replaceAll(' ', '-')}`"
  >
    <div class="d-flex justify-space-between align-center ga-3 mb-2">
      <span class="text-body-small text-medium-emphasis">{{ label }}</span>
      <span
        class="text-label-large font-weight-bold tabular-nums"
        :class="`text-${color}`"
        data-test="budget-progress-percent"
      >
        {{ roundedPercent }}%
      </span>
    </div>

    <v-progress-linear
      v-if="limitCents > 0"
      :model-value="progress"
      :color="color"
      height="10"
      rounded
      :aria-label="`${label}: ${formatMoney(fromCents(usedCents), currency)} ${usedLabel.toLowerCase()} of ${formatMoney(fromCents(limitCents), currency)} ${targetLabel}, ${roundedPercent} percent`"
      data-test="budget-progress-bar"
    />
    <div class="d-flex flex-wrap justify-space-between align-center ga-2 mt-2">
      <span class="text-body-small tabular-nums" data-test="budget-progress-amount">
        {{ formatMoney(fromCents(usedCents), currency) }} {{ usedLabel.toLowerCase() }}
        <template v-if="limitCents > 0">
          of {{ formatMoney(fromCents(limitCents), currency) }}
        </template>
      </span>
      <span v-if="over" class="text-body-small text-error font-weight-medium">
        {{ formatMoney(difference, currency) }} over
      </span>
      <span v-else-if="limitCents > 0" class="text-body-small text-medium-emphasis">
        {{ formatMoney(difference, currency) }} left
      </span>
      <span v-else class="text-body-small text-medium-emphasis">No target set</span>
    </div>
  </section>
</template>
