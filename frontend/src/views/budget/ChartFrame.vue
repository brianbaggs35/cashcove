<script setup lang="ts">
import { ChartColumn, Table2 } from '@lucide/vue'
import { ref, useId } from 'vue'

/**
 * A chart's frame: its title, a way to read the same numbers as a table (which is how anyone
 * not reading the picture gets every value), and a legend over the chart.
 */
defineProps<{ title: string; description?: string }>()

const id = useId()
const view = ref<'chart' | 'table'>('chart')
</script>

<template>
  <section class="chart chart-frame" :aria-labelledby="id" data-test="chart-frame">
    <header class="d-flex align-start flex-wrap ga-3 mb-3">
      <div class="flex-grow-1">
        <h3 :id="id" class="text-title-medium font-weight-bold ma-0">{{ title }}</h3>
        <p v-if="description" class="text-body-small text-medium-emphasis ma-0 mt-1">
          {{ description }}
        </p>
      </div>
      <v-btn-toggle
        v-model="view"
        mandatory
        divided
        density="comfortable"
        variant="outlined"
        color="primary"
        aria-label="How to show it"
        data-test="chart-view"
      >
        <v-btn value="chart" size="small" :prepend-icon="ChartColumn" data-test="chart-view-chart">
          Chart
        </v-btn>
        <v-btn value="table" size="small" :prepend-icon="Table2" data-test="chart-view-table">
          Table
        </v-btn>
      </v-btn-toggle>
    </header>
    <template v-if="view === 'chart'">
      <div
        v-if="$slots.legend"
        class="d-flex flex-wrap align-center gc-4 gr-1 mb-2"
        data-test="chart-legend"
      >
        <slot name="legend" />
      </div>
      <slot name="chart" />
    </template>
    <!-- It scrolls when long, so it takes focus: a keyboard can't reach a scroll area otherwise. -->
    <div
      v-else
      class="chart-frame__table"
      role="region"
      tabindex="0"
      :aria-label="`${title} as a table`"
      data-test="chart-table"
    >
      <slot name="table" />
    </div>
  </section>
</template>

<style scoped>
.chart-frame__table {
  max-height: 340px;
  overflow: auto;
}

.chart-frame__table:focus-visible {
  outline: 3px solid rgba(var(--v-theme-primary), 0.55);
  outline-offset: 2px;
}

.chart-frame__table :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.chart-frame__table :deep(th),
.chart-frame__table :deep(td) {
  padding: 8px 12px 8px 0;
  text-align: end;
  white-space: nowrap;
  border-bottom: 1px solid var(--chart-grid);
}

.chart-frame__table :deep(th:first-child),
.chart-frame__table :deep(td:first-child) {
  text-align: start;
}

.chart-frame__table :deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--chart-surface);
  font-weight: 600;
}

.chart-frame__table :deep(caption) {
  padding-bottom: 8px;
  text-align: start;
  color: var(--chart-muted);
}
</style>
