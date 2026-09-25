<script setup lang="ts">
import { formatMoney, formatShortDate } from '@/utils/format'

/** Shows how amounts and dates will look with a currency and number format. */
defineProps<{ currency: string; locale: string }>()
const today = new Date()
</script>

<template>
  <v-sheet
    rounded="lg"
    class="format-preview d-flex flex-wrap ga-6 pa-4"
    data-test="format-preview"
  >
    <div>
      <div class="text-label-medium text-medium-emphasis">Amounts look like</div>
      <div class="text-title-medium font-weight-bold tabular-nums">
        {{ formatMoney(1234.56, currency, locale) }}
      </div>
    </div>
    <div>
      <div class="text-label-medium text-medium-emphasis">Dates look like</div>
      <div class="text-title-medium font-weight-bold">{{ formatShortDate(today, locale) }}</div>
    </div>
  </v-sheet>
</template>

<style scoped>
.format-preview {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
}
</style>
