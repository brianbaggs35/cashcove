import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { useAiStore } from '@/stores/ai'
import { aiOff, makeAiSettings, makeModel, makeProviders } from '@/test/ai'
import { answer } from '@/test/confirm'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import AiSection from '@/views/settings/AiSection.vue'

interface Options {
  settings?: api.AiSettings
  role?: 'admin' | 'viewer'
  providers?: api.AiProvider[]
}

async function render({
  settings = aiOff,
  role = 'admin',
  providers = makeProviders(),
}: Options = {}) {
  const mounted = await mountWithPlugins(AiSection, {
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      const ai = useAiStore()
      ai.providers = providers
      ai.settings = settings
    },
  })
  await flushPromises()
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const choose = async (key: api.AiProviderKey) => {
    await find(`provider-${key}`).find('input').setValue(true)
    await flushPromises()
  }
  const type = async (name: string, text: string) => {
    await find(name).find('input').setValue(text)
  }
  const items = () =>
    (wrapper.findComponent({ name: 'VSelect' }).props('items') as { value: string }[]).map(
      (item) => item.value,
    )
  const model = () => wrapper.findComponent({ name: 'VSelect' }).props('modelValue') as string
  const pick = async (id: string) => {
    await wrapper.findComponent({ name: 'VSelect' }).setValue(id)
  }
  const submit = async () => {
    await find('ai-form').trigger('submit')
    await flushPromises()
  }
  return { ...mounted, find, choose, type, items, model, pick, submit }
}

const connection = (changes: Partial<api.AiConnectionInput>): api.AiConnectionInput => ({
  provider: 'openai',
  base_url: null,
  api_key: null,
  model: null,
  ...changes,
})

describe('AiSection', () => {
  beforeEach(() => {
    notices.value = []
  })

  describe('before anything is set up', () => {
    it('says AI is optional and offers the four providers, with nothing to fill in yet', async () => {
      const { wrapper, find } = await render()

      expect(find('ai-status').text()).toBe('Off')
      expect(wrapper.text()).toContain('It’s optional. Cashcove works the same without it')
      const names = wrapper
        .findAll('.ai-provider')
        .map((card) => card.find('.text-body-large').text())
      expect(names).toEqual(['Ollama (on your computer)', 'Ollama Cloud', 'Anthropic', 'OpenAI'])
      expect(wrapper.text()).toContain('Runs models on your own hardware')
      expect(find('ai-key').exists()).toBe(false)
      expect(find('ai-url').exists()).toBe(false)
      expect(find('ai-model').exists()).toBe(false)
      expect(find('ai-save').exists()).toBe(false)
      expect(find('ai-off').exists()).toBe(false)
    })

    it('explains what the AI can and can’t see', async () => {
      const { wrapper } = await render()

      expect(wrapper.text()).toContain('What the AI can see')
      expect(wrapper.text()).toContain('Cashcove never sends account information to an AI')
      expect(wrapper.text()).toContain('The names of your accounts, and the names of your banks.')
    })

    it('shows a skeleton while it loads', async () => {
      vi.spyOn(api, 'fetchAiProviders').mockReturnValue(new Promise(() => undefined))
      vi.spyOn(api, 'fetchAiSettings').mockReturnValue(new Promise(() => undefined))

      const { wrapper } = await mountWithPlugins(AiSection)

      expect(wrapper.find('[data-test="ai-settings-loading"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="ai-provider"]').exists()).toBe(false)
    })

    it('says when it can’t load, and loads again when asked', async () => {
      vi.spyOn(api, 'fetchAiProviders').mockRejectedValueOnce(
        new ApiError(0, 'Can’t reach Cashcove.', { code: 'offline' }),
      )
      vi.spyOn(api, 'fetchAiProviders').mockResolvedValue(makeProviders())
      vi.spyOn(api, 'fetchAiSettings').mockResolvedValue(aiOff)
      const { wrapper } = await mountWithPlugins(AiSection)
      await flushPromises()

      expect(wrapper.find('[data-test="ai-settings-error"]').text()).toContain(
        "Couldn't load the AI settings.",
      )

      await wrapper.find('[data-test="ai-settings-retry"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-test="ai-settings-error"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="ai-provider"]').exists()).toBe(true)
    })
  })

  describe('OpenAI', () => {
    it('has a key and a list of models to choose from, with GPT-6 Luna chosen', async () => {
      const { find, choose, items, model, wrapper } = await render()

      await choose('openai')

      expect(find('ai-key').exists()).toBe(true)
      expect(find('ai-url').exists()).toBe(false)
      expect(find('ai-fetch').exists()).toBe(false)
      expect(items()).toEqual(['gpt-6-luna', 'gpt-5.4-nano'])
      expect(model()).toBe('gpt-6-luna')
      expect(wrapper.text()).toContain('The most efficient GPT-6, for focused, high-volume work.')
      expect(wrapper.text()).toContain('$0.10 in · $0.50 out per million tokens')
      expect(find('ai-key-link').attributes('href')).toBe('https://platform.openai.com/api-keys')
    })

    it('can’t be tried or saved until there’s a key', async () => {
      const { find, choose, type } = await render()
      await choose('openai')

      expect(find('ai-test').attributes('disabled')).toBeDefined()
      expect(find('ai-save').attributes('disabled')).toBeDefined()

      await type('ai-key', '  sk-openai-test-key  ')

      expect(find('ai-test').attributes('disabled')).toBeUndefined()
      expect(find('ai-save').attributes('disabled')).toBeUndefined()
    })

    it('saves the provider, the model and the key, and says it is on', async () => {
      const save = vi.spyOn(api, 'saveAiSettings').mockResolvedValue(makeAiSettings())
      const { find, choose, type, submit } = await render()
      await choose('openai')
      await type('ai-key', '  sk-openai-test-key  ')

      await submit()

      expect(save).toHaveBeenCalledWith({
        provider: 'openai',
        model: 'gpt-6-luna',
        base_url: null,
        api_key: 'sk-openai-test-key',
        review_imports: true,
      })
      expect(notices.value.map((notice) => notice.text)).toEqual(['AI settings saved'])
      expect(find('ai-status').text()).toBe('On · GPT-6 Luna')
      // The key is on the server now, and not in the form.
      expect(find('ai-key').find('input').element.value).toBe('')
      expect(find('ai-off').exists()).toBe(true)
    })

    it('saves another model, and whether imported files get a second opinion', async () => {
      const save = vi.spyOn(api, 'saveAiSettings').mockResolvedValue(makeAiSettings())
      const { find, choose, type, pick, submit } = await render()
      await choose('openai')
      await type('ai-key', 'sk-openai-test-key')
      await pick('gpt-5.4-nano')
      await find('ai-review-imports').find('input').setValue(false)

      await submit()

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gpt-5.4-nano', review_imports: false }),
      )
    })

    it('says what went wrong when saving fails', async () => {
      vi.spyOn(api, 'saveAiSettings').mockRejectedValue(
        new ApiError(422, 'Enter the provider’s API key.', { code: 'key_required' }),
      )
      const { find, choose, type, submit } = await render()
      await choose('openai')
      await type('ai-key', 'sk-openai-test-key')

      await submit()

      expect(find('ai-error').text()).toBe('Enter the provider’s API key.')
      expect(notices.value).toEqual([])
    })

    it('tries the provider as the form has it, and says it worked', async () => {
      const test = vi
        .spyOn(api, 'testAiConnection')
        .mockResolvedValue({ ok: true, message: 'GPT-6 Luna answered.' })
      const { find, choose, type } = await render()
      await choose('openai')
      await type('ai-key', 'sk-openai-test-key')

      await find('ai-test').trigger('click')
      await flushPromises()

      expect(test).toHaveBeenCalledWith(
        connection({ provider: 'openai', api_key: 'sk-openai-test-key', model: 'gpt-6-luna' }),
      )
      expect(find('ai-test-result').text()).toBe('GPT-6 Luna answered.')
      expect(find('ai-test-result').classes()).toContain('v-alert--variant-tonal')
      expect(find('ai-test-result').attributes('class')).toContain('success')
    })

    it('says what to fix when the provider says no, and forgets that when the form changes', async () => {
      vi.spyOn(api, 'testAiConnection').mockResolvedValue({
        ok: false,
        message: 'The provider didn’t accept the key.',
      })
      const { find, choose, type } = await render()
      await choose('openai')
      await type('ai-key', 'wrong-key-12345')

      await find('ai-test').trigger('click')
      await flushPromises()
      expect(find('ai-test-result').text()).toBe('The provider didn’t accept the key.')
      expect(find('ai-test-result').attributes('class')).toContain('error')

      await type('ai-key', 'another-key-12345')
      expect(find('ai-test-result').exists()).toBe(false)
    })

    it('says what went wrong when the test itself can’t be made', async () => {
      vi.spyOn(api, 'testAiConnection').mockRejectedValue(
        new ApiError(0, 'Can’t reach Cashcove.', { code: 'offline' }),
      )
      const { find, choose, type } = await render()
      await choose('openai')
      await type('ai-key', 'sk-openai-test-key')

      await find('ai-test').trigger('click')
      await flushPromises()

      expect(find('ai-error').text()).toBe('Can’t reach Cashcove.')
    })

    it('marks a model that is being shut down in the choices, and names what to use instead', async () => {
      const { wrapper, choose } = await render()
      await choose('openai')

      await wrapper.find('.v-select .v-field').trigger('mousedown')
      await flushPromises()
      const choices = document.body.textContent

      expect(choices).toContain('GPT-5.4 nano')
      expect(choices).toContain('Shutting down')
      expect(choices).toContain('Use GPT-6 Luna instead')
    })
  })

  describe('Anthropic', () => {
    it('has a key and Claude Haiku 4.5 and Sonnet 5.5 to choose from, with Haiku chosen', async () => {
      const { find, choose, items, model } = await render()

      await choose('anthropic')

      expect(find('ai-key').exists()).toBe(true)
      expect(items()).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5-5'])
      expect(model()).toBe('claude-haiku-4-5-20251001')
    })

    it('saves Haiku, which is chosen to start with, and Sonnet when that is chosen', async () => {
      const save = vi
        .spyOn(api, 'saveAiSettings')
        .mockResolvedValue(
          makeAiSettings({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }),
        )
      const { choose, type, pick, submit } = await render()
      await choose('anthropic')
      await type('ai-key', 'sk-ant-test-key')

      await submit()

      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          api_key: 'sk-ant-test-key',
        }),
      )

      await choose('anthropic')
      await type('ai-key', 'sk-ant-test-key')
      await pick('claude-sonnet-5-5')
      await submit()

      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-5-5' }),
      )
    })
  })

  describe('Ollama on your computer', () => {
    it('has an address to start from instead of a key, and models to fetch', async () => {
      const { find, choose, items, model } = await render()

      await choose('ollama_local')

      expect(find('ai-key').exists()).toBe(false)
      expect(find('ai-url').find('input').element.value).toBe('http://host.docker.internal:11434')
      expect(find('ai-url').text()).toContain('localhost')
      expect(find('ai-url').text()).toContain('OLLAMA_HOST=0.0.0.0')
      expect(find('ai-fetch').exists()).toBe(true)
      expect(items()).toEqual([])
      expect(model()).toBe('')
      expect(find('ai-save').attributes('disabled')).toBeDefined()
      expect(find('ai-model').text()).toContain('Fetch the models first')
    })

    it('fetches the models from the address in the form, and offers them to choose from', async () => {
      const fetch = vi.spyOn(api, 'fetchAiModels').mockResolvedValue({
        models: [
          makeModel({
            id: 'llama3.2:3b',
            name: 'llama3.2:3b',
            note: '3.2B',
            input_price: null,
            output_price: null,
          }),
          makeModel({
            id: 'qwen3:8b',
            name: 'qwen3:8b',
            note: '8.2B',
            input_price: null,
            output_price: null,
          }),
        ],
      })
      const { find, choose, type, items, model, pick } = await render()
      await choose('ollama_local')
      await type('ai-url', '  http://192.168.1.20:11434  ')

      await find('ai-fetch').trigger('click')
      await flushPromises()

      expect(fetch).toHaveBeenCalledWith(
        connection({ provider: 'ollama_local', base_url: 'http://192.168.1.20:11434' }),
      )
      expect(items()).toEqual(['llama3.2:3b', 'qwen3:8b'])
      expect(find('ai-fetched').text()).toContain('Found 2 models that can chat')
      // The first is chosen, which can be changed.
      expect(model()).toBe('llama3.2:3b')
      await pick('qwen3:8b')
      expect(model()).toBe('qwen3:8b')
      expect(find('ai-save').attributes('disabled')).toBeUndefined()
    })

    it('stops asking for the models to be fetched once they have been, whatever a model has to say', async () => {
      vi.spyOn(api, 'fetchAiModels').mockResolvedValue({
        models: [
          makeModel({
            id: 'plain:1b',
            name: 'plain:1b',
            note: null,
            input_price: null,
            output_price: null,
          }),
        ],
      })
      const { find, choose } = await render()
      await choose('ollama_local')
      expect(find('ai-model').text()).toContain('Fetch the models first, then choose one.')

      await find('ai-fetch').trigger('click')
      await flushPromises()

      expect(find('ai-model').text()).not.toContain('Fetch the models first')
    })

    it('starts with an empty address when the server has none to suggest', async () => {
      const providers = makeProviders().map((item) =>
        item.key === 'ollama_local' ? { ...item, default_url: null } : item,
      )
      const { find, choose } = await render({ providers })

      await choose('ollama_local')

      expect(find('ai-url').find('input').element.value).toBe('')
    })

    it('keeps the model already chosen when it is among the models fetched', async () => {
      vi.spyOn(api, 'fetchAiModels').mockResolvedValue({
        models: [makeModel({ id: 'a:1b', name: 'a:1b' }), makeModel({ id: 'b:1b', name: 'b:1b' })],
      })
      const { find, model, items } = await render({
        settings: makeAiSettings({
          provider: 'ollama_local',
          model: 'b:1b',
          base_url: 'http://ollama.lan:11434',
          api_key_set: false,
        }),
      })
      expect(items()).toEqual(['b:1b'])

      await find('ai-fetch').trigger('click')
      await flushPromises()

      expect(items()).toEqual(['a:1b', 'b:1b'])
      expect(model()).toBe('b:1b')
    })

    it('says to pull a model when the server has none that can chat', async () => {
      vi.spyOn(api, 'fetchAiModels').mockResolvedValue({ models: [] })
      const { find, choose, model } = await render()
      await choose('ollama_local')

      await find('ai-fetch').trigger('click')
      await flushPromises()

      expect(find('ai-fetched').text()).toContain('ollama pull llama3.2')
      expect(model()).toBe('')
    })

    it('says why the models couldn’t be fetched', async () => {
      vi.spyOn(api, 'fetchAiModels').mockRejectedValue(
        new ApiError(502, 'Cashcove can’t reach Ollama at http://host.docker.internal:11434.', {
          code: 'ai_unreachable',
        }),
      )
      const { find, choose } = await render()
      await choose('ollama_local')

      await find('ai-fetch').trigger('click')
      await flushPromises()

      expect(find('ai-fetch-error').text()).toContain('can’t reach Ollama')
      expect(find('ai-fetched').exists()).toBe(false)
    })

    it('won’t fetch or try an address that isn’t one, and says how it should start', async () => {
      const { find, choose, type, wrapper } = await render()
      await choose('ollama_local')

      await type('ai-url', 'localhost:11434')
      expect(find('ai-fetch').attributes('disabled')).toBeDefined()
      expect(find('ai-test').attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('Start it with http:// or https://')

      await type('ai-url', '')
      expect(find('ai-fetch').attributes('disabled')).toBeDefined()
      // Nothing is said until there's something typed to be wrong.
      expect(wrapper.text()).not.toContain('Enter the address of your Ollama server.')

      await type('ai-url', 'http://ollama.lan:11434')
      expect(find('ai-fetch').attributes('disabled')).toBeUndefined()
    })

    it('tries the connection without a model by listing what the server has', async () => {
      const test = vi.spyOn(api, 'testAiConnection').mockResolvedValue({
        ok: true,
        message: 'Connected. Ollama (on your computer) has 2 models to choose from.',
      })
      const { find, choose } = await render()
      await choose('ollama_local')

      await find('ai-test').trigger('click')
      await flushPromises()

      expect(test).toHaveBeenCalledWith(
        connection({ provider: 'ollama_local', base_url: 'http://host.docker.internal:11434' }),
      )
      expect(find('ai-test-result').text()).toContain('Connected.')
    })

    it('saves the address and the model, and no key', async () => {
      const save = vi
        .spyOn(api, 'saveAiSettings')
        .mockResolvedValue(
          makeAiSettings({ provider: 'ollama_local', model: 'llama3.2:3b', api_key_set: false }),
        )
      vi.spyOn(api, 'fetchAiModels').mockResolvedValue({
        models: [makeModel({ id: 'llama3.2:3b', name: 'llama3.2:3b' })],
      })
      const { find, choose, submit } = await render()
      await choose('ollama_local')
      await find('ai-fetch').trigger('click')
      await flushPromises()

      await submit()

      expect(save).toHaveBeenCalledWith({
        provider: 'ollama_local',
        model: 'llama3.2:3b',
        base_url: 'http://host.docker.internal:11434',
        api_key: null,
        review_imports: true,
      })
    })
  })

  describe('Ollama Cloud', () => {
    it('has a key and models to fetch, and no address', async () => {
      const { find, choose } = await render()

      await choose('ollama_cloud')

      expect(find('ai-key').exists()).toBe(true)
      expect(find('ai-url').exists()).toBe(false)
      expect(find('ai-fetch').exists()).toBe(true)
      expect(find('ai-key-link').attributes('href')).toBe('https://ollama.com/settings/keys')
      expect(find('ai-fetch').attributes('disabled')).toBeDefined()
    })

    it('fetches the models with the key typed, before it is saved', async () => {
      const fetch = vi.spyOn(api, 'fetchAiModels').mockResolvedValue({
        models: [
          makeModel({
            id: 'gemma4:31b',
            name: 'gemma4:31b',
            note: '31B',
            input_price: '0.14',
            output_price: '0.40',
          }),
        ],
      })
      const { wrapper, find, choose, type, items, model } = await render()
      await choose('ollama_cloud')
      await type('ai-key', 'ollama-cloud-test-key')

      await find('ai-fetch').trigger('click')
      await flushPromises()

      expect(fetch).toHaveBeenCalledWith(
        connection({ provider: 'ollama_cloud', api_key: 'ollama-cloud-test-key' }),
      )
      expect(items()).toEqual(['gemma4:31b'])
      expect(model()).toBe('gemma4:31b')
      // Each model says what it costs, from Ollama’s own price list.
      expect(wrapper.text()).toContain('$0.14 in · $0.40 out per million tokens')
    })

    it('tries the key with the model that was chosen', async () => {
      const test = vi
        .spyOn(api, 'testAiConnection')
        .mockResolvedValue({ ok: true, message: 'gemma4:31b answered.' })
      vi.spyOn(api, 'fetchAiModels').mockResolvedValue({
        models: [makeModel({ id: 'gemma4:31b', name: 'gemma4:31b' })],
      })
      const { find, choose, type } = await render()
      await choose('ollama_cloud')
      await type('ai-key', 'ollama-cloud-test-key')
      await find('ai-fetch').trigger('click')
      await flushPromises()

      await find('ai-test').trigger('click')
      await flushPromises()

      expect(test).toHaveBeenCalledWith(
        connection({
          provider: 'ollama_cloud',
          api_key: 'ollama-cloud-test-key',
          model: 'gemma4:31b',
        }),
      )
    })
  })

  describe('with AI already set up', () => {
    const saved = makeAiSettings({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })

    it('shows what is saved, and says a key is', async () => {
      const { find, model, wrapper } = await render({ settings: saved })

      expect(find('ai-status').text()).toBe('On · Claude Haiku 4.5')
      expect(model()).toBe('claude-haiku-4-5-20251001')
      expect(wrapper.text()).toContain(
        'A key is saved for this provider. Leave this blank to keep it',
      )
      expect(find('ai-off').exists()).toBe(true)
    })

    it('can be tried and saved without typing the key again', async () => {
      const test = vi
        .spyOn(api, 'testAiConnection')
        .mockResolvedValue({ ok: true, message: 'Claude Haiku 4.5 answered.' })
      const save = vi.spyOn(api, 'saveAiSettings').mockResolvedValue(saved)
      const { find, submit } = await render({ settings: saved })
      expect(find('ai-test').attributes('disabled')).toBeUndefined()

      await find('ai-test').trigger('click')
      await flushPromises()
      expect(test).toHaveBeenCalledWith(
        connection({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }),
      )

      await submit()
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic', api_key: null }),
      )
    })

    it('shows the review of imports as it is saved', async () => {
      const { find } = await render({ settings: makeAiSettings({ review_imports: false }) })

      expect((find('ai-review-imports').find('input').element as HTMLInputElement).checked).toBe(
        false,
      )
    })

    it('starts the saved provider from what is saved when it is chosen again, and others from their own', async () => {
      const { choose, model, find } = await render({ settings: saved })

      await choose('openai')
      expect(model()).toBe('gpt-6-luna')
      // Another provider's key isn't the saved one.
      expect(find('ai-save').attributes('disabled')).toBeDefined()
      expect(find('ai-test').attributes('disabled')).toBeDefined()

      await choose('anthropic')
      expect(model()).toBe('claude-haiku-4-5-20251001')
      expect(find('ai-save').attributes('disabled')).toBeUndefined()
    })

    it('starts Ollama from its saved address and model when it is the saved one', async () => {
      const ollama = makeAiSettings({
        provider: 'ollama_local',
        model: 'qwen3:8b',
        base_url: 'http://ollama.lan:11434',
        api_key_set: false,
      })
      const { choose, find, model } = await render({ settings: ollama })
      expect(find('ai-url').find('input').element.value).toBe('http://ollama.lan:11434')
      expect(model()).toBe('qwen3:8b')

      await choose('openai')
      await choose('ollama_local')

      expect(find('ai-url').find('input').element.value).toBe('http://ollama.lan:11434')
      expect(model()).toBe('qwen3:8b')
    })

    it('turns AI off after asking, and forgets the key', async () => {
      const remove = vi.spyOn(api, 'removeAiSettings').mockResolvedValue(undefined)
      vi.spyOn(api, 'fetchAiSettings').mockResolvedValue(aiOff)
      const { find } = await render({ settings: saved })

      await find('ai-off').trigger('click')
      await flushPromises()
      expect(remove).not.toHaveBeenCalled()
      await answer(true)

      expect(remove).toHaveBeenCalledTimes(1)
      expect(notices.value.map((notice) => notice.text)).toEqual(['AI is off'])
      expect(find('ai-status').text()).toBe('Off')
      expect(find('ai-off').exists()).toBe(false)
      expect(find('ai-save').exists()).toBe(false)
    })

    it('leaves AI on when turning it off is called off', async () => {
      const remove = vi.spyOn(api, 'removeAiSettings')
      const { find } = await render({ settings: saved })

      await find('ai-off').trigger('click')
      await flushPromises()
      await answer(false)

      expect(remove).not.toHaveBeenCalled()
      expect(find('ai-status').text()).toBe('On · Claude Haiku 4.5')
      expect(notices.value).toEqual([])
    })

    it('doesn’t offer a model name for one it has no name for', async () => {
      const { find } = await render({
        settings: makeAiSettings({ provider: 'ollama_cloud', model: 'gemma4:31b' }),
      })

      expect(find('ai-status').text()).toBe('On · gemma4:31b')
    })
  })

  describe('for a viewer', () => {
    it('shows how AI is set up, and nothing to change', async () => {
      const { wrapper, find } = await render({
        role: 'viewer',
        settings: makeAiSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' }),
      })

      expect(find('read-only-notice').text()).toContain('Only an admin can change it')
      expect(find('ai-summary').text()).toContain('Anthropic')
      expect(find('ai-summary').text()).toContain('Claude Sonnet 5.5')
      expect(find('ai-summary').text()).toContain('Get a second opinion on how they were sorted')
      expect(find('ai-form').exists()).toBe(false)
      expect(wrapper.find('input').exists()).toBe(false)
      expect(find('ai-status').text()).toBe('On · Claude Sonnet 5.5')
    })

    it('says when imports aren’t reviewed', async () => {
      const { find } = await render({
        role: 'viewer',
        settings: makeAiSettings({ review_imports: false }),
      })

      expect(find('ai-summary').text()).toContain('Aren’t reviewed')
    })

    it('says an admin can turn AI on, when it is off', async () => {
      const { find } = await render({ role: 'viewer' })

      expect(find('ai-summary').text()).toBe('An admin can turn it on here.')
    })
  })
})
