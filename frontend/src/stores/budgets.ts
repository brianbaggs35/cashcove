import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchBudgets, type Budget } from '@/api/budget'
import { errorMessage } from '@/api/client'
import { todayIso } from '@/utils/dates'

/** The household's budgets, for choosing between them and for naming the one something counts toward. */
export const useBudgetsStore = defineStore('budgets', () => {
  const budgets = ref<Budget[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let pending: Promise<void> | null = null

  const byId = computed(() => new Map(budgets.value.map((item) => [item.id, item])))

  /** Loads them again, which a change to what counts toward one calls for. */
  function load(): Promise<void> {
    pending ??= (async () => {
      loading.value = true
      error.value = null
      try {
        budgets.value = await fetchBudgets(todayIso())
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

  /** Loads them the first time something needs them. */
  function ensureLoaded(): Promise<void> {
    return loaded.value ? Promise.resolve() : load()
  }

  function find(id: string | null | undefined): Budget | undefined {
    return id ? byId.value.get(id) : undefined
  }

  return { budgets, loaded, loading, error, byId, load, ensureLoaded, find }
})
