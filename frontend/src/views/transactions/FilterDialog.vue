<script setup lang="ts">
import { ListFilter } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import type { TransactionSource } from '@/api/transactions'
import AppDialog from '@/components/ui/AppDialog.vue'
import DateField from '@/components/ui/DateField.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { copyFilters, emptyFilters, type TransactionFilters } from '@/views/transactions/view'

/** Every way to narrow the list, applied together once chosen. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  filters: TransactionFilters
  /** Opened by choosing custom dates, so the dates come first. */
  focus?: 'dates' | null
}>()
const emit = defineEmits<{ apply: [filters: TransactionFilters] }>()

const accounts = useAccountsStore()
const categories = useCategoriesStore()

const draft = reactive<TransactionFilters>(emptyFilters())
const valid = ref(true)

watch(open, (value) => {
  if (!value) return
  Object.assign(draft, copyFilters(props.filters))
  if (props.focus === 'dates' && draft.period !== 'custom') {
    draft.period = 'custom'
    draft.start = null
    draft.end = null
  }
})

const accountItems = computed(() =>
  accounts.accounts.map((account) => ({
    value: account.id,
    title: account.name,
    props: { subtitle: account.closed_at ? 'Closed' : (account.institution ?? undefined) },
  })),
)

const UNCATEGORIZED = 'none'

interface CategoryOption {
  type?: 'subheader'
  value?: string
  title: string
  emoji?: string
}

const categoryItems = computed<CategoryOption[]>(() => [
  { value: UNCATEGORIZED, title: 'Uncategorized' },
  ...categories.groups
    .filter((group) => group.categories.length > 0)
    .flatMap((group): CategoryOption[] => [
      { type: 'subheader', title: group.name },
      ...group.categories.map((category) => ({
        value: category.id,
        title: category.name,
        emoji: category.emoji,
      })),
    ]),
])

/** Uncategorized is picked alongside categories, as it is in the address. */
const chosenCategories = computed({
  get: () => (draft.uncategorized ? [UNCATEGORIZED, ...draft.categories] : draft.categories),
  set: (values: string[]) => {
    draft.uncategorized = values.includes(UNCATEGORIZED)
    draft.categories = values.filter((value) => value !== UNCATEGORIZED)
  },
})

const sources: { value: TransactionSource; title: string }[] = [
  { value: 'manual', title: 'Added by hand' },
  { value: 'plaid', title: 'From the bank' },
  { value: 'file', title: 'Imported from a file' },
]

const customDates = computed({
  get: () => draft.period === 'custom',
  set: (value: boolean) => {
    draft.period = value ? 'custom' : 'all'
    draft.start = null
    draft.end = null
  },
})

function apply() {
  if (!valid.value) return
  emit('apply', copyFilters(draft))
  open.value = false
}

function clearAll() {
  Object.assign(draft, { ...emptyFilters(), q: draft.q })
}
</script>

<template>
  <AppDialog
    v-model="open"
    title="Filters"
    subtitle="Show only the transactions that match all of these."
    :icon="ListFilter"
    max-width="640"
    fullscreen-on-mobile
  >
    <v-form v-model="valid" @submit.prevent="apply">
      <section class="mb-5">
        <div class="d-flex align-center justify-space-between mb-2">
          <h3 class="text-title-small font-weight-bold ma-0">Dates</h3>
          <v-switch
            v-model="customDates"
            label="Choose dates"
            color="primary"
            density="compact"
            hide-details
            data-test="filter-custom-dates"
          />
        </div>
        <v-row v-if="customDates" dense>
          <v-col cols="12" sm="6">
            <DateField v-model="draft.start" label="From" data-test="filter-start" />
          </v-col>
          <v-col cols="12" sm="6">
            <DateField
              v-model="draft.end"
              label="To"
              :min="draft.start ?? undefined"
              data-test="filter-end"
            />
          </v-col>
        </v-row>
        <p v-else class="text-body-small text-medium-emphasis ma-0">
          Uses the period chosen beside the search.
        </p>
      </section>

      <v-autocomplete
        v-model="draft.accounts"
        :items="accountItems"
        label="Accounts"
        multiple
        chips
        closable-chips
        clearable
        data-test="filter-accounts"
      />

      <v-autocomplete
        v-model="chosenCategories"
        :items="categoryItems"
        label="Categories"
        multiple
        chips
        closable-chips
        clearable
        class="mt-2"
        data-test="filter-categories"
      >
        <template #chip="{ props: chip, item }">
          <v-chip v-bind="chip">
            <span v-if="item.emoji" class="me-1" aria-hidden="true">{{ item.emoji }}</span>
            {{ item.title }}
          </v-chip>
        </template>
      </v-autocomplete>

      <v-row dense class="mt-2">
        <v-col cols="12" sm="6">
          <div id="filter-direction-label" class="text-label-large mb-2">Direction</div>
          <v-btn-toggle
            v-model="draft.direction"
            divided
            variant="outlined"
            density="comfortable"
            color="primary"
            aria-labelledby="filter-direction-label"
            data-test="filter-direction"
          >
            <v-btn value="in">Money in</v-btn>
            <v-btn value="out">Money out</v-btn>
          </v-btn-toggle>
        </v-col>
        <v-col cols="12" sm="6">
          <div id="filter-status-label" class="text-label-large mb-2">Status</div>
          <v-btn-toggle
            v-model="draft.status"
            divided
            variant="outlined"
            density="comfortable"
            color="primary"
            aria-labelledby="filter-status-label"
            data-test="filter-status"
          >
            <v-btn value="pending">Pending</v-btn>
            <v-btn value="posted">Posted</v-btn>
          </v-btn-toggle>
        </v-col>
      </v-row>

      <div id="filter-source-label" class="text-label-large mt-5 mb-2">Where they came from</div>
      <v-chip-group
        v-model="draft.sources"
        multiple
        column
        selected-class="text-primary"
        aria-labelledby="filter-source-label"
        data-test="filter-sources"
      >
        <v-chip
          v-for="source in sources"
          :key="source.value"
          :value="source.value"
          variant="outlined"
          filter
        >
          {{ source.title }}
        </v-chip>
      </v-chip-group>

      <div class="text-label-large mt-5 mb-2">Amount, in or out</div>
      <v-row dense>
        <v-col cols="6">
          <MoneyField v-model="draft.min" label="At least" data-test="filter-min" />
        </v-col>
        <v-col cols="6">
          <MoneyField v-model="draft.max" label="At most" data-test="filter-max" />
        </v-col>
      </v-row>
      <!-- Lets Enter apply the filters. -->
      <button type="submit" hidden />
    </v-form>

    <template #actions>
      <v-btn variant="text" class="me-auto" data-test="filter-clear" @click="clearAll">
        Clear all
      </v-btn>
      <v-btn variant="text" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!valid"
        data-test="filter-apply"
        @click="apply"
      >
        Show results
      </v-btn>
    </template>
  </AppDialog>
</template>
