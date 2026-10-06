import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  fetchAiProviders,
  fetchAiSettings,
  fetchRecommendations,
  removeAiSettings,
  saveAiSettings,
  type AiProvider,
  type AiSettings,
  type AiSettingsInput,
  type RecommendationCounts,
} from '@/api/ai'
import { errorMessage } from '@/api/client'

/**
 * How the household's AI is set up, and the providers it can choose from. AI is optional: until
 * it's set up, nothing in Cashcove asks it anything, and every page works without it.
 */
export const useAiStore = defineStore('ai', () => {
  const providers = ref<AiProvider[]>([])
  const settings = ref<AiSettings | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** How many suggestions are waiting, applied and turned down, once they've been counted. */
  const counts = ref<RecommendationCounts | null>(null)
  let pending: Promise<void> | null = null

  const loaded = computed(() => settings.value !== null)
  /** AI is set up and ready to be asked. */
  const configured = computed(() => settings.value?.configured ?? false)
  /** A statement file that was just imported gets a second opinion. */
  const reviewsImports = computed(() => configured.value && !!settings.value?.review_imports)
  const provider = computed(() =>
    providers.value.find((candidate) => candidate.key === settings.value?.provider),
  )
  /** The model's name as people know it: its name on the provider's list, or what it's called. */
  const modelName = computed(() => {
    const id = settings.value?.model
    return provider.value?.models.find((model) => model.id === id)?.name ?? id ?? null
  })

  function load(): Promise<void> {
    pending ??= (async () => {
      loading.value = true
      error.value = null
      try {
        const [list, current] = await Promise.all([fetchAiProviders(), fetchAiSettings()])
        providers.value = list
        settings.value = current
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

  /** Counts the suggestions, for the badge on the tab. It stays as it was if they can't be counted. */
  async function loadCounts(): Promise<void> {
    try {
      counts.value = (await fetchRecommendations({ page_size: 1 })).counts
    } catch {
      // The tab just goes without a badge; the page itself says if it can't load.
    }
  }

  /** Saves the provider and model. Leaving the key out keeps the one saved for the provider. */
  async function save(input: AiSettingsInput): Promise<void> {
    settings.value = await saveAiSettings(input)
  }

  /** Turns AI off and forgets the key. */
  async function remove(): Promise<void> {
    await removeAiSettings()
    settings.value = await fetchAiSettings()
  }

  return {
    providers,
    settings,
    loading,
    error,
    counts,
    loaded,
    configured,
    reviewsImports,
    provider,
    modelName,
    load,
    ensureLoaded,
    loadCounts,
    save,
    remove,
  }
})
