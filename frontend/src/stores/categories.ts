import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { Category, CategoryGroup } from '@/api/categories'
import { fetchCategories } from '@/api/categories'
import { errorMessage } from '@/api/client'

/** A category with the group it belongs to. */
export interface GroupedCategory extends Category {
  group: CategoryGroup
}

/** The household's categories, shared by Transactions and Settings. */
export const useCategoriesStore = defineStore('categories', () => {
  const groups = ref<CategoryGroup[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let pending: Promise<void> | null = null

  const byId = computed(
    () =>
      new Map(
        groups.value.flatMap((group) =>
          group.categories.map((category): [string, GroupedCategory] => [
            category.id,
            { ...category, group },
          ]),
        ),
      ),
  )
  const count = computed(() => byId.value.size)

  function load(): Promise<void> {
    pending ??= (async () => {
      loading.value = true
      error.value = null
      try {
        groups.value = await fetchCategories()
        loaded.value = true
      } catch (loadError) {
        error.value = errorMessage(loadError)
      } finally {
        loading.value = false
        pending = null
      }
    })()
    return pending
  }

  function ensureLoaded(): Promise<void> {
    return loaded.value ? Promise.resolve() : load()
  }

  function find(id: string | null | undefined): GroupedCategory | undefined {
    return id ? byId.value.get(id) : undefined
  }

  return { groups, loaded, loading, error, byId, count, load, ensureLoaded, find }
})
