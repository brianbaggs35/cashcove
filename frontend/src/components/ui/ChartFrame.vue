<script setup lang="ts">
import { ChartColumn, Table2 } from '@lucide/vue'
import { computed, ref, useId } from 'vue'

/**
 * A chart's frame: its title, a way to read the same numbers as a table (which is how anyone
 * not reading the picture gets every value), and a legend over the chart. A table with more
 * `rows` than fit shows the first ones, and the rest when asked for: a table that scrolls inside
 * the page can't be reached from a keyboard, and is awkward on a phone.
 */
const props = withDefaults(defineProps<{ title: string; description?: string; rows?: number }>(), {
  description: undefined,
  rows: 0,
})

/** How many rows of a long table show before the rest is asked for. */
const ROW_LIMIT = 12

const id = useId()
const view = ref<'chart' | 'table'>('chart')
const showAll = ref(false)
/** How many rows the table slot shows. */
const limit = computed(() => (showAll.value ? props.rows : ROW_LIMIT))
const more = computed(() => !showAll.value && props.rows > ROW_LIMIT)
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
    <div v-else class="chart-frame__table" data-test="chart-table">
      <slot name="table" :limit="limit" />
      <v-btn
        v-if="more"
        variant="text"
        size="small"
        class="mt-2"
        data-test="chart-table-more"
        @click="showAll = true"
      >
        Show all {{ rows }} rows
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
/* The tables fit, so this only keeps an unusually wide one from widening the page. */
.chart-frame__table {
  overflow-x: auto;
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
  border-bottom: 1px solid var(--chart-grid);
}

/* Numbers stay whole; the headings give way, so a table fits a phone. */
.chart-frame__table :deep(td) {
  white-space: nowrap;
}

.chart-frame__table :deep(th:first-child),
.chart-frame__table :deep(td:first-child) {
  text-align: start;
}

.chart-frame__table :deep(thead th) {
  font-weight: 600;
}

.chart-frame__table :deep(caption) {
  padding-bottom: 8px;
  text-align: start;
  color: var(--chart-muted);
}
</style>
