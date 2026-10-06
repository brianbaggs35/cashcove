<script setup lang="ts">
import { useDisplay } from 'vuetify'

import type { UsageGroup } from '@/api/ai'
import { useHousehold } from '@/composables/useHousehold'
import { formatCost, formatTokens } from '@/utils/ai'

/**
 * What the AI was asked and what it cost, a row for each model or each purpose. A phone has no
 * room for every column, so the numbers go under the name.
 */
defineProps<{ caption: string; heading: string; rows: UsageGroup[] }>()

const { xs } = useDisplay()
const { locale } = useHousehold()
</script>

<template>
  <table class="usage-table" data-test="usage-table">
    <caption class="d-sr-only">
      {{
        caption
      }}
    </caption>
    <thead>
      <tr>
        <th scope="col">{{ heading }}</th>
        <template v-if="!xs">
          <th scope="col">Calls</th>
          <th scope="col">Tokens in</th>
          <th scope="col">Tokens out</th>
        </template>
        <th scope="col">Cost</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in rows" :key="row.key" data-test="usage-row">
        <th scope="row">
          {{ row.label }}
          <span v-if="xs" class="usage-table__more" data-test="usage-more">
            {{ row.calls.toLocaleString('en-US') }} calls ·
            {{ formatTokens(row.input_tokens, locale) }} in ·
            {{ formatTokens(row.output_tokens, locale) }} out
          </span>
        </th>
        <template v-if="!xs">
          <td>{{ row.calls.toLocaleString('en-US') }}</td>
          <td>{{ formatTokens(row.input_tokens, locale) }}</td>
          <td>{{ formatTokens(row.output_tokens, locale) }}</td>
        </template>
        <td>{{ formatCost(row.cost_micros, locale) }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.usage-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.usage-table th,
.usage-table td {
  padding: 10px 12px 10px 0;
  text-align: end;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.usage-table th:first-child,
.usage-table td:first-child {
  text-align: start;
}

.usage-table td {
  white-space: nowrap;
}

.usage-table thead th {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.usage-table tbody th {
  font-weight: 500;
  overflow-wrap: anywhere;
}

.usage-table tbody tr:last-child > * {
  border-bottom: 0;
}

.usage-table__more {
  display: block;
  font-size: 0.75rem;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
