import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchPreferences, savePreferences, type Preferences } from '@/api/preferences'

// A JSON round trip also unwraps Vue's reactive proxies, which structuredClone rejects.
const clone = (value: Preferences): Preferences => JSON.parse(JSON.stringify(value)) as Preferences

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
    } catch (caught) {
      error.value = messageOf(caught)
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
    } catch (caught) {
      error.value = messageOf(caught)
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
