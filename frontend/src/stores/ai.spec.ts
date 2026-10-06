import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/ai'
import { useAiStore } from '@/stores/ai'
import { aiOff, makeAiSettings, makeProviders, makeRecommendationPage } from '@/test/ai'

function stubLoads(settings = makeAiSettings()) {
  return {
    providers: vi.spyOn(api, 'fetchAiProviders').mockResolvedValue(makeProviders()),
    settings: vi.spyOn(api, 'fetchAiSettings').mockResolvedValue(settings),
  }
}

describe('ai store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts with AI off: nothing is set up until something has loaded it', () => {
    const store = useAiStore()

    expect(store.loaded).toBe(false)
    expect(store.configured).toBe(false)
    expect(store.reviewsImports).toBe(false)
    expect(store.provider).toBeUndefined()
    expect(store.modelName).toBeNull()
  })

  it('loads the providers and the settings once, however many ask', async () => {
    const { providers, settings } = stubLoads()
    const store = useAiStore()

    await Promise.all([store.ensureLoaded(), store.load()])
    await store.ensureLoaded()

    expect(providers).toHaveBeenCalledTimes(1)
    expect(settings).toHaveBeenCalledTimes(1)
    expect(store.loaded).toBe(true)
    expect(store.configured).toBe(true)
    expect(store.provider?.name).toBe('OpenAI')
    expect(store.modelName).toBe('GPT-6 Luna')
    expect(store.reviewsImports).toBe(true)
  })

  it('names a model it has no name for by what it is called', async () => {
    stubLoads(makeAiSettings({ provider: 'ollama_local', model: 'llama3.2:3b' }))
    const store = useAiStore()

    await store.load()

    expect(store.modelName).toBe('llama3.2:3b')
  })

  it('doesn’t review imports when that is turned off, or AI is', async () => {
    stubLoads(makeAiSettings({ review_imports: false }))
    const store = useAiStore()
    await store.load()
    expect(store.configured).toBe(true)
    expect(store.reviewsImports).toBe(false)

    store.settings = aiOff
    expect(store.configured).toBe(false)
    expect(store.reviewsImports).toBe(false)
  })

  it('keeps what went wrong, and loads again when asked', async () => {
    const providers = vi
      .spyOn(api, 'fetchAiProviders')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(makeProviders())
    vi.spyOn(api, 'fetchAiSettings').mockResolvedValue(makeAiSettings())
    const store = useAiStore()

    await store.load()

    expect(store.error).toBe('Offline')
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(false)

    await store.load()

    expect(providers).toHaveBeenCalledTimes(2)
    expect(store.error).toBeNull()
    expect(store.loaded).toBe(true)
  })

  it('counts the suggestions, and goes without when it can’t', async () => {
    const fetch = vi
      .spyOn(api, 'fetchRecommendations')
      .mockResolvedValueOnce(
        makeRecommendationPage([], { counts: { open: 3, applied: 1, dismissed: 0 } }),
      )
      .mockRejectedValueOnce(new Error('Offline'))
    const store = useAiStore()

    await store.loadCounts()
    expect(fetch).toHaveBeenCalledWith({ page_size: 1 })
    expect(store.counts).toEqual({ open: 3, applied: 1, dismissed: 0 })

    await store.loadCounts()
    expect(store.counts).toEqual({ open: 3, applied: 1, dismissed: 0 })
  })

  it('saves the settings and keeps what the API says they are', async () => {
    const saved = makeAiSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
    const save = vi.spyOn(api, 'saveAiSettings').mockResolvedValue(saved)
    const store = useAiStore()
    const input = {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      base_url: null,
      api_key: 'sk-ant-test-key',
      review_imports: true,
    } as const

    await store.save(input)

    expect(save).toHaveBeenCalledWith(input)
    expect(store.settings).toEqual(saved)
  })

  it('turns AI off and reads what is left', async () => {
    const remove = vi.spyOn(api, 'removeAiSettings').mockResolvedValue(undefined)
    vi.spyOn(api, 'fetchAiSettings').mockResolvedValue(aiOff)
    const store = useAiStore()
    store.settings = makeAiSettings()

    await store.remove()

    expect(remove).toHaveBeenCalledTimes(1)
    expect(store.configured).toBe(false)
    expect(store.settings).toEqual(aiOff)
  })
})
