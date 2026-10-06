<script setup lang="ts">
import { CircleAlert, CopyCheck, Pencil, WandSparkles } from '@lucide/vue'
import { computed, ref, shallowRef, useId, watch } from 'vue'

import type { StatementRow } from '@/api/ai'
import type { ImportPreview, PreviewRow, RowStatus } from '@/api/imports'
import type { TransactionSource } from '@/api/transactions'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { importable, useImportWizard } from '@/stores/importWizard'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { formatListDate } from '@/utils/dates'
import { coveredByBank } from '@/views/import/columns'
import StatementRowDialog from '@/views/import/StatementRowDialog.vue'

/** The file's rows: which are new, which the account already has, and which to import. */
const wizard = useImportWizard()
const subscriptions = useSubscriptionsStore()
const { locale } = useHousehold()
const filterLabel = useId()

type Filter = 'all' | RowStatus | 'check'

/** Rows shown at a time; a year of a busy card is a few hundred. */
const PAGE = 50
const filter = ref<Filter>('all')
const shown = ref(PAGE)

const titles: Record<Filter, string> = {
  all: 'All',
  check: 'Needs a look',
  new: 'New',
  possible_duplicate: 'Maybe there',
  duplicate: 'Already there',
  invalid: 'Can’t be read',
}

const SOURCES: Record<TransactionSource, string> = {
  manual: 'added by hand',
  plaid: 'from the bank',
  file: 'imported',
}

const preview = computed(() => wizard.preview as ImportPreview)
const rows = computed(() => preview.value.rows)
/** Why rows the AI read should be checked, by the row's number. */
const flags = computed(() => wizard.statementNotes)
const editable = computed(() => wizard.source === 'statement')
const chosen = computed(() => new Set(wizard.selected))
const accountName = computed(() => wizard.account?.name ?? 'the account')

const filters = computed(() => {
  const counts = new Map<Filter, number>([['all', rows.value.length]])
  for (const row of rows.value) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
    if (flags.value.has(row.line)) counts.set('check', (counts.get('check') ?? 0) + 1)
  }
  return (Object.keys(titles) as Filter[])
    .filter((key) => counts.has(key))
    .map((key) => ({ value: key, title: titles[key], count: counts.get(key) as number }))
})

const filtered = computed(() => {
  if (filter.value === 'all') return rows.value
  if (filter.value === 'check') return rows.value.filter((row) => flags.value.has(row.line))
  return rows.value.filter((row) => row.status === filter.value)
})
const visible = computed(() => filtered.value.slice(0, shown.value))

/** Ticking the box at the top ticks every row in view that can be imported. */
const choosable = computed(() => filtered.value.filter(importable))
const chosenCount = computed(
  () => choosable.value.filter((row) => chosen.value.has(row.line)).length,
)
const allChosen = computed(
  () => choosable.value.length > 0 && chosenCount.value === choosable.value.length,
)

function chooseAll() {
  wizard.select(
    choosable.value.map((row) => row.line),
    !allChosen.value,
  )
}

watch(filter, () => {
  shown.value = PAGE
})

// A new reading of the file may have none of the rows the filter picks.
watch(filters, (list) => {
  if (!list.some((item) => item.value === filter.value)) filter.value = 'all'
})

function note(row: PreviewRow): string | null {
  const match = row.match
  const day = (value: string) => formatListDate(value, locale.value)
  switch (row.status) {
    case 'invalid':
      return row.problem
    case 'duplicate':
      return `Already in ${accountName.value}`
    case 'possible_duplicate':
      return match
        ? `Might be ${match.payee} on ${day(match.date)}, ${SOURCES[match.source]}`
        : `Might already be in ${accountName.value}`
    default:
      if (coveredByBank(row, preview.value.bank_history))
        return 'On a day the bank already shared through Plaid'
      return row.description && row.description !== row.payee ? row.description : null
  }
}

/** What automations will do to a row, in words. */
function automationNote(row: PreviewRow): string | null {
  const effect = row.automation
  if (!effect) return null
  const linked = effect.subscription_id
    ? ` · linked to ${subscriptions.find(effect.subscription_id)?.name ?? 'a subscription or bill'}`
    : ''
  return `Sorted by your automations${linked}`
}

const name = (row: PreviewRow) => row.payee ?? row.description ?? 'Unknown payee'

// Correcting a row the AI read.
const editing = shallowRef<StatementRow | null>(null)
const editOpen = ref(false)

function edit(row: PreviewRow) {
  editing.value = wizard.statementRows.find((item) => item.line === row.line) ?? null
  editOpen.value = true
}
</script>

<template>
  <div data-test="review-rows">
    <div :id="filterLabel" class="d-sr-only">Show</div>
    <v-chip-group
      v-model="filter"
      mandatory
      column
      selected-class="text-primary"
      class="mb-2"
      :aria-labelledby="filterLabel"
      data-test="review-filters"
    >
      <v-chip
        v-for="item in filters"
        :key="item.value"
        :value="item.value"
        variant="tonal"
        size="small"
        :data-test="`review-filter-${item.value}`"
      >
        {{ item.title }}
        <span class="review-rows__count ms-1">{{ item.count.toLocaleString('en-US') }}</span>
      </v-chip>
    </v-chip-group>

    <div class="review-rows">
      <div
        class="review-rows__head d-flex align-center ga-3 px-3 py-1"
        data-test="review-rows-head"
      >
        <v-checkbox-btn
          :model-value="allChosen"
          :indeterminate="chosenCount > 0 && !allChosen"
          :disabled="!choosable.length"
          density="compact"
          class="flex-grow-0"
          :aria-label="allChosen ? 'Untick every row shown' : 'Tick every row shown'"
          data-test="review-choose-all"
          @update:model-value="chooseAll"
        />
        <span class="text-body-small text-medium-emphasis">
          {{ chosenCount.toLocaleString('en-US') }} of
          {{ choosable.length.toLocaleString('en-US') }}
          ticked
        </span>
      </div>

      <component
        :is="importable(row) ? 'label' : 'div'"
        v-for="row in visible"
        :key="row.line"
        class="review-rows__row d-flex align-center ga-3 px-3 py-2"
        :class="[
          `review-rows__row--${row.status}`,
          { 'review-rows__row--chosen': chosen.has(row.line) },
        ]"
        data-test="review-row"
      >
        <v-checkbox-btn
          v-if="importable(row)"
          :model-value="chosen.has(row.line)"
          density="compact"
          class="flex-grow-0"
          data-test="review-row-check"
          @update:model-value="(on: unknown) => wizard.select([row.line], !!on)"
        />
        <span v-else class="review-rows__mark" aria-hidden="true">
          <v-icon :icon="row.status === 'invalid' ? CircleAlert : CopyCheck" size="18" />
        </span>
        <span class="review-rows__date text-body-small text-medium-emphasis tabular-nums">
          {{ row.date ? formatListDate(row.date, locale) : `Line ${row.line}` }}
        </span>
        <span class="flex-grow-1" style="min-width: 0">
          <span class="d-flex align-center ga-2" style="min-width: 0">
            <span class="text-body-medium font-weight-medium text-truncate">{{ name(row) }}</span>
            <CategoryChip
              v-if="row.category_id"
              :category-id="row.category_id"
              size="x-small"
              class="flex-shrink-1"
            />
          </span>
          <span
            v-if="automationNote(row)"
            class="review-rows__auto d-flex align-center ga-1 text-body-small"
            data-test="review-row-automation"
          >
            <v-icon :icon="WandSparkles" size="14" aria-hidden="true" />
            {{ automationNote(row) }}
          </span>
          <span
            v-if="flags.get(row.line)"
            class="review-rows__flag d-flex align-start ga-1 text-body-small"
            data-test="review-row-flag"
          >
            <v-icon :icon="CircleAlert" size="14" aria-hidden="true" class="mt-1 flex-shrink-0" />
            {{ flags.get(row.line) }}
          </span>
          <span
            v-if="note(row)"
            class="review-rows__note text-body-small"
            data-test="review-row-note"
          >
            {{ note(row) }}
          </span>
        </span>
        <MoneyAmount
          v-if="row.amount"
          :amount="row.amount"
          :currency="wizard.account?.currency"
          signed
          class="text-body-medium font-weight-bold flex-shrink-0"
        />
        <v-btn
          v-if="editable"
          :icon="Pencil"
          variant="text"
          size="small"
          density="comfortable"
          class="flex-shrink-0"
          :aria-label="`Edit ${name(row)}`"
          data-test="review-row-edit"
          @click.prevent="edit(row)"
        />
      </component>

      <div v-if="filtered.length > shown" class="px-3 py-2">
        <v-btn variant="text" size="small" data-test="review-more" @click="shown += PAGE">
          Show {{ Math.min(PAGE, filtered.length - shown) }} more
        </v-btn>
      </div>
    </div>

    <StatementRowDialog v-model="editOpen" :row="editing" />
  </div>
</template>

<style scoped>
.review-rows {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
  overflow: hidden;
}

.review-rows__head {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.review-rows__row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

label.review-rows__row {
  cursor: pointer;
}

label.review-rows__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.review-rows__row--chosen {
  background: rgba(var(--v-theme-primary), 0.05);
}

.review-rows__row--duplicate,
.review-rows__row--invalid {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.review-rows__mark {
  display: grid;
  flex: 0 0 28px;
  place-items: center;
}

.review-rows__row--invalid .review-rows__mark,
.review-rows__row--invalid .review-rows__note {
  color: rgb(var(--v-theme-error));
}

.review-rows__auto {
  color: rgb(var(--v-theme-primary));
}

.review-rows__flag {
  color: rgb(var(--v-theme-warning));
}

.review-rows__row--possible_duplicate .review-rows__note {
  color: rgb(var(--v-theme-warning));
}

/* Notes say why a row is ticked or not, so they get a second line on phones. */
.review-rows__note {
  display: -webkit-box;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

/* Wide enough for a date in another year, "Sep 23, 2025". */
.review-rows__date {
  flex: 0 0 84px;
}

.review-rows__count {
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 599.98px) {
  .review-rows__date {
    flex-basis: 52px;
  }
}
</style>
