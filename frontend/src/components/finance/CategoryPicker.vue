<script setup lang="ts">
import { computed } from 'vue'

import { useCategoriesStore, type GroupedCategory } from '@/stores/categories'

/** Picks a transaction's category, grouped the way Settings lists them. Clearing leaves it uncategorized. */
const model = defineModel<string | null>({ required: true })
const props = withDefaults(
  defineProps<{
    label?: string
    hideDetails?: boolean
    disabled?: boolean
    /** A category to leave out, e.g. the one being deleted. */
    exclude?: string | null
  }>(),
  { label: 'Category', hideDetails: false, disabled: false, exclude: null },
)

const categories = useCategoriesStore()
void categories.ensureLoaded()

interface Option {
  type: 'subheader' | 'item'
  title: string
  group: string
  value?: string
  emoji?: string
}

const items = computed<Option[]>(() =>
  categories.groups.flatMap((group): Option[] => {
    const choices = group.categories.filter((category) => category.id !== props.exclude)
    if (!choices.length) return []
    return [
      { type: 'subheader', title: group.name, group: group.name },
      ...choices.map((category): Option => ({
        type: 'item',
        title: category.name,
        group: group.name,
        value: category.id,
        emoji: category.emoji,
      })),
    ]
  }),
)

const selected = computed<GroupedCategory | undefined>(() => categories.find(model.value))

/** Finds categories by their own name or their group's. */
function filter(title: string, query: string, item?: { raw: Option }): boolean {
  const { group } = (item as { raw: Option }).raw
  return `${title}\n${group}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}
</script>

<template>
  <v-autocomplete
    v-model="model"
    :items="items"
    :label="label"
    :custom-filter="filter"
    :loading="categories.loading"
    :disabled="disabled"
    :hide-details="hideDetails"
    item-title="title"
    item-value="value"
    clearable
    auto-select-first
    no-data-text="No categories match"
    data-test="category-picker"
  >
    <template v-if="selected" #prepend-inner>
      <span class="category-picker__emoji" aria-hidden="true">{{ selected.emoji }}</span>
    </template>
    <template #item="{ props: itemProps, item }">
      <v-list-item v-bind="itemProps" :title="item.title">
        <template #prepend>
          <span class="category-picker__emoji me-3" aria-hidden="true">{{ item.emoji }}</span>
        </template>
      </v-list-item>
    </template>
  </v-autocomplete>
</template>

<style scoped>
.category-picker__emoji {
  font-size: 1.15rem;
  line-height: 1;
}
</style>
