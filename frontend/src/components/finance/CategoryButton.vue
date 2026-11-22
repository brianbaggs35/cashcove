<script setup lang="ts">
import { Check, ChevronDown, CircleDashed, Search } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import CategoryChip from '@/components/finance/CategoryChip.vue'
import { useCategoriesStore } from '@/stores/categories'

/**
 * A transaction's category as a button: it looks like the category's chip and opens a list to
 * choose another from, or none. It only says what was chosen, for the page to save, and does
 * nothing for the category it already has.
 */
const props = withDefaults(
  defineProps<{
    categoryId: string | null
    /** What it's for, so the button says more than the category: "Change the category of Coffee". */
    subject: string
    disabled?: boolean
  }>(),
  { disabled: false },
)
const emit = defineEmits<{ select: [categoryId: string | null] }>()

const categories = useCategoriesStore()
const open = ref(false)
const search = ref('')

const current = computed(() => categories.find(props.categoryId))
const label = computed(
  () => `Change the category of ${props.subject}, now ${current.value?.name ?? 'uncategorized'}`,
)

// The list starts from the top each time, with the categories not yet loaded fetched on the way.
watch(open, (isOpen) => {
  if (!isOpen) return
  search.value = ''
  void categories.ensureLoaded()
})

/** The groups with the categories that match the search, by their own name or their group's. */
const groups = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return categories.groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter(
        (category) =>
          !query ||
          category.name.toLocaleLowerCase().includes(query) ||
          group.name.toLocaleLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.categories.length)
})
/** Taking the category away is offered until a search is looking for something else. */
const offersNone = computed(
  () => !search.value.trim() || 'uncategorized'.includes(search.value.trim().toLocaleLowerCase()),
)

function choose(categoryId: string | null) {
  open.value = false
  if (categoryId !== props.categoryId) emit('select', categoryId)
}
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom start" max-width="320">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        type="button"
        class="category-button"
        :disabled="disabled"
        :aria-label="label"
        data-test="category-button"
        @click.stop
      >
        <CategoryChip :category-id="categoryId" />
        <ChevronDown class="category-button__chevron" :size="14" aria-hidden="true" />
      </button>
    </template>
    <v-card min-width="260" data-test="category-menu">
      <v-text-field
        v-model="search"
        :prepend-inner-icon="Search"
        label="Find a category"
        density="compact"
        variant="solo-filled"
        flat
        hide-details
        clearable
        autofocus
        class="pa-2"
        data-test="category-search"
      />
      <v-list
        density="compact"
        nav
        max-height="320"
        class="category-button__list"
        aria-label="Categories"
      >
        <v-list-item
          v-if="offersNone"
          :prepend-icon="CircleDashed"
          title="Uncategorized"
          :active="categoryId === null"
          data-test="category-option-none"
          @click="choose(null)"
        >
          <template v-if="categoryId === null" #append>
            <Check :size="16" aria-hidden="true" />
          </template>
        </v-list-item>
        <template v-for="group in groups" :key="group.id">
          <v-list-subheader>{{ group.name }}</v-list-subheader>
          <v-list-item
            v-for="category in group.categories"
            :key="category.id"
            :title="category.name"
            :active="category.id === categoryId"
            :data-test="`category-option-${category.id}`"
            @click="choose(category.id)"
          >
            <template #prepend>
              <span class="category-button__emoji me-3" aria-hidden="true">
                {{ category.emoji }}
              </span>
            </template>
            <template v-if="category.id === categoryId" #append>
              <Check :size="16" aria-hidden="true" />
            </template>
          </v-list-item>
        </template>
        <p
          v-if="!groups.length && !offersNone"
          class="text-body-medium text-medium-emphasis px-4 py-3 ma-0"
          data-test="category-none-match"
        >
          No categories match
        </p>
      </v-list>
    </v-card>
  </v-menu>
</template>

<style scoped>
.category-button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  padding: 2px 4px 2px 0;
  border-radius: 999px;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color 160ms ease;
}

.category-button:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.category-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.category-button__chevron {
  flex: none;
  opacity: 0.6;
}

.category-button__list {
  overflow-y: auto;
}

.category-button__emoji {
  font-size: 1.15rem;
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .category-button {
    transition: none;
  }
}
</style>
