<script setup lang="ts">
import { BookmarkCheck, CircleAlert, Sparkles } from '@lucide/vue'
import { computed, ref, useId } from 'vue'

import type {
  ColumnField,
  CsvLayout,
  CsvPreview,
  ImportOptions,
  ImportPreview,
} from '@/api/imports'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useImportWizard } from '@/stores/importWizard'
import { formatListDate } from '@/utils/dates'
import {
  assignColumn,
  columnFields,
  dateOrders,
  decimalMarks,
  delimiters,
  fieldOf,
} from '@/views/import/columns'
import { transactionCount } from '@/views/import/file'

/** Matching a CSV file's columns to what they hold, with its first rows as they read. */
const wizard = useImportWizard()
const { locale } = useHousehold()
const directionLabel = useId()

/** What a column holds, as the menu offers it: `skip` for columns that aren't imported. */
type Choice = ColumnField | 'skip'
const choices = [{ value: 'skip', title: 'Not imported' }, ...columnFields]
/** How many of the first rows show how the file reads. */
const FIRST_ROWS = 6

const preview = computed(() => wizard.preview as ImportPreview)
const options = computed(() => wizard.options as ImportOptions)
const layout = computed(() => options.value.csv as CsvLayout)
const csv = computed(() => preview.value.csv as CsvPreview)
const firstRows = computed(() => preview.value.rows.slice(0, FIRST_ROWS))
const summary = computed(() => preview.value.summary)
/** The file's own lines are only worth a look when the transactions don't start at the top. */
const layoutOpen = ref(layout.value.skip_rows > 0 || !layout.value.header ? [0] : [])

const choiceOf = (index: number): Choice => fieldOf(layout.value.columns, index) ?? 'skip'

function change(changes: Partial<ImportOptions>) {
  wizard.changeOptions({ ...options.value, ...changes })
}

function changeLayout(changes: Partial<CsvLayout>) {
  change({ csv: { ...layout.value, ...changes } })
}

function assign(index: number, choice: Choice) {
  change({ csv: assignColumn(layout.value, index, choice === 'skip' ? null : choice) })
}

function skipRows(value: number | null) {
  changeLayout({ skip_rows: Math.min(Math.max(Math.round(value ?? 0), 0), 100) })
}

/** The direction column's values that mean money in, as the file writes them. */
const moneyIn = computed(() => {
  const chosen = new Set(layout.value.money_in_values.map((value) => value.toLowerCase()))
  return csv.value.direction_values.filter((value) => chosen.has(value.toLowerCase()))
})

const missing = computed(() => {
  const fields = csv.value.missing
  if (!fields.length) return null
  return `Choose the column with each transaction’s ${fields.join(' and ')}.`
})

const unreadable = computed(() => {
  const count = summary.value.invalid
  if (!count || missing.value) return null
  return count === 1 ? '1 row can’t be read' : `${count.toLocaleString('en-US')} rows can’t be read`
})

/** Lines above the column names, or above the transactions when there are none, are skipped. */
function lineClass(index: number): string | undefined {
  if (index < layout.value.skip_rows) return 'file-lines__line--skipped'
  if (index === layout.value.skip_rows && layout.value.header) return 'file-lines__line--header'
  return undefined
}
</script>

<template>
  <div data-test="import-columns">
    <v-alert
      v-if="wizard.profileName"
      :icon="BookmarkCheck"
      color="secondary"
      variant="tonal"
      density="compact"
      class="mb-4"
      data-test="columns-saved-format"
    >
      Read with your saved format, {{ wizard.profileName }}. Anything you change here updates it
      when you import.
    </v-alert>
    <v-alert
      v-else
      :icon="Sparkles"
      color="primary"
      variant="tonal"
      density="compact"
      class="mb-4"
      data-test="columns-detected"
    >
      Cashcove matched the columns by their names and what’s in them. Check what each one holds.
    </v-alert>

    <v-alert
      v-if="missing"
      :icon="CircleAlert"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="missing"
      data-test="columns-missing"
    />

    <div class="columns-list mb-6" data-test="columns-list">
      <div
        v-for="column in csv.columns"
        :key="column.index"
        class="columns-list__row d-flex flex-column flex-sm-row align-sm-center ga-2 ga-sm-4 px-4 py-3"
        :class="{ 'columns-list__row--used': choiceOf(column.index) !== 'skip' }"
        data-test="column-row"
      >
        <div class="flex-grow-1" style="min-width: 0">
          <div class="text-title-small font-weight-bold text-break" data-test="column-name">
            {{ column.name }}
          </div>
          <div class="columns-list__samples text-body-small text-medium-emphasis text-truncate">
            {{ column.samples.join(' · ') || 'Empty' }}
          </div>
        </div>
        <v-select
          :model-value="choiceOf(column.index)"
          :items="choices"
          :aria-label="`What ${column.name} holds`"
          density="compact"
          hide-details
          class="columns-list__choice flex-grow-0"
          data-test="column-choice"
          @update:model-value="(choice: Choice) => assign(column.index, choice)"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item
              v-bind="itemProps"
              :subtitle="'subtitle' in item ? item.subtitle : undefined"
            />
          </template>
        </v-select>
      </div>
    </div>

    <div class="text-title-small font-weight-bold mb-3">How it’s written</div>
    <v-row density="compact">
      <v-col cols="12" sm="6">
        <v-select
          :model-value="options.date_order"
          :items="dateOrders"
          label="Dates"
          data-test="columns-date-order"
          @update:model-value="(date_order) => change({ date_order })"
        />
      </v-col>
      <v-col cols="12" sm="6">
        <v-select
          :model-value="options.decimal_mark"
          :items="decimalMarks"
          label="Amounts"
          data-test="columns-decimal-mark"
          @update:model-value="(decimal_mark) => change({ decimal_mark })"
        />
      </v-col>
    </v-row>
    <v-switch
      v-if="layout.amounts === 'one'"
      :model-value="options.flip"
      label="Money going out is positive"
      hint="Common in credit card files, where charges are positive and payments negative."
      persistent-hint
      color="primary"
      inset
      density="compact"
      class="mb-2"
      data-test="columns-flip"
      @update:model-value="(flip) => change({ flip: !!flip })"
    />
    <div v-else-if="layout.amounts === 'direction'" class="mb-2" data-test="columns-direction">
      <div :id="directionLabel" class="text-label-large mb-1">Which of these mean money in?</div>
      <v-chip-group
        :model-value="moneyIn"
        multiple
        column
        selected-class="text-primary"
        :aria-labelledby="directionLabel"
        @update:model-value="(values: string[]) => changeLayout({ money_in_values: values })"
      >
        <v-chip
          v-for="value in csv.direction_values"
          :key="value"
          :value="value"
          variant="tonal"
          filter
          data-test="columns-direction-value"
        >
          {{ value }}
        </v-chip>
      </v-chip-group>
      <div class="text-body-small text-medium-emphasis">The rest count as money going out.</div>
    </div>

    <v-expansion-panels v-model="layoutOpen" class="mt-4 mb-6" data-test="columns-layout">
      <v-expansion-panel elevation="0" rounded="lg" class="columns-layout">
        <v-expansion-panel-title>
          <div>
            <div class="text-title-small font-weight-bold">File layout</div>
            <div class="text-body-small text-medium-emphasis">
              How the file splits into columns, and where the transactions start
            </div>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-row density="compact" class="mt-1">
            <v-col cols="12" sm="4">
              <v-select
                :model-value="layout.delimiter"
                :items="delimiters"
                label="Separated by"
                data-test="columns-delimiter"
                @update:model-value="(delimiter) => changeLayout({ delimiter })"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-number-input
                :model-value="layout.skip_rows"
                :min="0"
                :max="100"
                label="Lines to skip first"
                control-variant="split"
                data-test="columns-skip-rows"
                @update:model-value="skipRows"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-switch
                :model-value="layout.header"
                label="Names its columns"
                color="primary"
                inset
                density="compact"
                data-test="columns-header"
                @update:model-value="(header) => changeLayout({ header: !!header })"
              />
            </v-col>
          </v-row>
          <div class="file-lines" data-test="columns-lines">
            <table>
              <caption class="d-sr-only">
                The file’s first lines
              </caption>
              <tbody>
                <tr v-for="(line, index) in csv.lines" :key="index" :class="lineClass(index)">
                  <th scope="row">{{ index + 1 }}</th>
                  <td v-for="(cell, cellIndex) in line" :key="cellIndex">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <div class="d-flex align-center flex-wrap ga-2 mb-2">
      <div class="text-title-small font-weight-bold">How the first rows read</div>
      <v-spacer />
      <span class="text-body-small text-medium-emphasis" data-test="columns-count">
        {{ transactionCount(summary.rows) }}
        <span v-if="unreadable" class="text-error">· {{ unreadable }}</span>
      </span>
    </div>
    <div class="first-rows" data-test="columns-rows">
      <div
        v-for="row in firstRows"
        :key="row.line"
        class="first-rows__row d-flex align-center ga-3 px-4 py-2"
        data-test="columns-row"
      >
        <span class="first-rows__date text-body-small text-medium-emphasis tabular-nums">
          {{ row.date ? formatListDate(row.date, locale) : '—' }}
        </span>
        <div class="flex-grow-1" style="min-width: 0">
          <div class="text-body-medium text-truncate">
            {{ row.payee ?? row.description ?? '' }}
          </div>
          <div v-if="row.problem" class="text-body-small text-error">{{ row.problem }}</div>
        </div>
        <MoneyAmount
          v-if="row.amount"
          :amount="row.amount"
          :currency="wizard.account?.currency"
          signed
          class="text-body-medium font-weight-medium"
        />
      </div>
      <div
        v-if="!firstRows.length"
        class="text-body-medium text-medium-emphasis text-center pa-4"
        data-test="columns-no-rows"
      >
        Rows show up here once the date and amount columns are chosen.
      </div>
    </div>
  </div>
</template>

<style scoped>
.columns-list,
.first-rows,
.columns-layout {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
}

.columns-list__row + .columns-list__row,
.first-rows__row + .first-rows__row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.columns-list__row {
  border-inline-start: 3px solid transparent;
}

.columns-list__row:first-child {
  border-start-start-radius: 14px;
}

.columns-list__row:last-child {
  border-end-start-radius: 14px;
}

.columns-list__row--used {
  border-inline-start-color: rgb(var(--v-theme-primary));
}

.columns-list__samples {
  font-variant-numeric: tabular-nums;
}

.columns-list__choice {
  width: 100%;
}

@media (min-width: 600px) {
  .columns-list__choice {
    width: 220px;
    min-width: 220px;
  }
}

.first-rows__date {
  flex: 0 0 88px;
}

.file-lines {
  overflow-x: auto;
  max-height: 260px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
}

.file-lines table {
  border-collapse: collapse;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 0.75rem;
  white-space: nowrap;
}

.file-lines th,
.file-lines td {
  padding: 4px 10px;
  text-align: start;
}

.file-lines th {
  position: sticky;
  left: 0;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-weight: 400;
  background: rgb(var(--v-theme-surface));
}

.file-lines tr + tr {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.file-lines__line--skipped td {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  text-decoration: line-through;
}

.file-lines__line--header td {
  font-weight: 700;
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
