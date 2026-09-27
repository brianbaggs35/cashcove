import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'

import { fetchPreferences, savePreferences, type Preferences } from '@/api/preferences'

// structuredClone rejects Vue's reactive proxies, so it copies the plain object underneath.
const clone = (value: Preferences): Preferences => structuredClone(toRaw(value))

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Household preferences: `saved` mirrors the server, `draft` is what the Settings forms edit. */
export const usePreferencesStore = defineStore('preferences', () => {
  const saved = ref<Preferences | null>(null)
  const draft = ref<Preferences | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const dirty = computed(() => JSON.stringify(saved.value) !== JSON.stringify(draft.value))

  async function load() {
    loading.value = true
    error.value = null
    try {
      saved.value = await fetchPreferences()
      draft.value = clone(saved.value)
    } catch (loadError) {
      error.value = messageOf(loadError)
    } finally {
      loading.value = false
    }
  }

  async function save(): Promise<boolean> {
    if (!draft.value) return false
    saving.value = true
    error.value = null
    try {
      saved.value = await savePreferences(draft.value)
      draft.value = clone(saved.value)
      return true
    } catch (saveError) {
      error.value = messageOf(saveError)
      return false
    } finally {
      saving.value = false
    }
  }

  function discard() {
    draft.value = saved.value && clone(saved.value)
  }

  return { saved, draft, loading, saving, error, dirty, load, save, discard }
})
