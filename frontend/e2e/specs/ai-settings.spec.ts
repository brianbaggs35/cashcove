import {
  AI_KEYS,
  expect,
  OLLAMA_ADDRESS,
  OLLAMA_DOWN_ADDRESS,
  OLLAMA_MODELS,
  setUpAi,
  signInFiles,
  test,
  type AiProviderKey,
} from '../support'

interface Settings {
  configured: boolean
  provider: AiProviderKey | null
  model: string | null
  base_url: string | null
  api_key_set: boolean
  review_imports: boolean
}

const PROVIDERS: AiProviderKey[] = ['ollama_local', 'ollama_cloud', 'anthropic', 'openai']

test.describe('AI settings', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('AI is off until it is set up, and says it is optional', async ({ aiSettingsPage }) => {
      await aiSettingsPage.goto()

      await expect(aiSettingsPage.status).toHaveText('Off')
      await expect(aiSettingsPage.page.getByTestId('ai-settings')).toContainText(
        'It’s optional. Cashcove works the same without it',
      )
      for (const provider of PROVIDERS)
        await expect(aiSettingsPage.provider(provider)).toBeVisible()
      // Nothing to fill in until a provider is chosen.
      await expect(aiSettingsPage.saveButton).toHaveCount(0)
      await expect(aiSettingsPage.privacy).toContainText('The names of your accounts')
    })

    test('OpenAI: a key that isn’t accepted is caught by the test, and the right one saves with GPT-6 Luna', async ({
      aiSettingsPage,
      apiAs,
      harness,
    }) => {
      await aiSettingsPage.goto()
      await aiSettingsPage.chooseProvider('openai')

      // GPT-6 Luna is first and chosen, with the smaller GPT-5 models after it and no big ones.
      await expect(aiSettingsPage.model).toContainText('GPT-6 Luna')
      expect(await aiSettingsPage.modelChoices()).toEqual([
        'GPT-6 Luna',
        'GPT-5.6 Luna',
        'GPT-5.4 mini',
        'GPT-5.4 nano',
        'GPT-5 mini',
        'GPT-5 nano',
      ])
      await expect(aiSettingsPage.testButton).toBeDisabled()

      await aiSettingsPage.enterKey('not-the-key')
      await aiSettingsPage.test()
      await expect(aiSettingsPage.testResult).toContainText("The provider didn't accept the key")

      // Changing the key makes that answer out of date, and the right one is accepted.
      await aiSettingsPage.enterKey(AI_KEYS.openai)
      await expect(aiSettingsPage.testResult).toHaveCount(0)
      await aiSettingsPage.test()
      await expect(aiSettingsPage.testResult).toHaveText('GPT-6 Luna answered.')

      await aiSettingsPage.save()
      await expect(aiSettingsPage.status).toHaveText('On · GPT-6 Luna')

      // The key stays on the server: the form is empty again, and the API never sends it back.
      await expect(aiSettingsPage.key.locator('input')).toHaveValue('')
      await expect(aiSettingsPage.key).toContainText('A key is saved for this provider')
      await expect(aiSettingsPage.page.locator('body')).not.toContainText(AI_KEYS.openai)
      const api = await apiAs('admin')
      const saved = await api.get<Settings>('/ai/settings')
      expect(saved).toMatchObject({ configured: true, provider: 'openai', api_key_set: true })
      expect(JSON.stringify(saved)).not.toContain(AI_KEYS.openai)

      // OpenAI got the wrong key once, and the right one every other time.
      const requests = (await harness.aiRequests()).filter(
        (request) => request.provider === 'openai',
      )
      expect(requests.map((request) => request.authorized)).toEqual([false, true])
    })

    test('Anthropic: Claude Haiku 4.5 is chosen to start with, Sonnet 5.5 is the other choice, and either can be saved', async ({
      aiSettingsPage,
    }) => {
      await aiSettingsPage.goto()
      await aiSettingsPage.chooseProvider('anthropic')

      await expect(aiSettingsPage.model).toContainText('Claude Haiku 4.5')
      expect(await aiSettingsPage.modelChoices()).toEqual(['Claude Haiku 4.5', 'Claude Sonnet 5.5'])
      await aiSettingsPage.enterKey(AI_KEYS.anthropic)
      await aiSettingsPage.test()
      await expect(aiSettingsPage.testResult).toHaveText('Claude Haiku 4.5 answered.')
      await aiSettingsPage.save()
      await expect(aiSettingsPage.status).toHaveText('On · Claude Haiku 4.5')

      await aiSettingsPage.chooseModel('Claude Sonnet 5.5')
      await aiSettingsPage.test()
      await expect(aiSettingsPage.testResult).toHaveText('Claude Sonnet 5.5 answered.')
      await aiSettingsPage.save()
      await expect(aiSettingsPage.status).toHaveText('On · Claude Sonnet 5.5')
    })

    test('Ollama on your computer: fetches the models, and the one chosen is tried and saved', async ({
      aiSettingsPage,
      apiAs,
      harness,
    }) => {
      await aiSettingsPage.goto()
      await aiSettingsPage.chooseProvider('ollama_local')

      // It starts from where Ollama is as the container sees it, and needs no key.
      await expect(aiSettingsPage.address.getByRole('textbox')).toHaveValue(OLLAMA_ADDRESS)
      await expect(aiSettingsPage.key).toHaveCount(0)
      await expect(aiSettingsPage.saveButton).toBeDisabled()

      await aiSettingsPage.fetchModels()
      // The model that only turns text into numbers can't chat, so it isn't offered.
      await expect(aiSettingsPage.fetched).toContainText('Found 2 models that can chat')
      expect(await aiSettingsPage.modelChoices()).toEqual([...OLLAMA_MODELS])
      await aiSettingsPage.chooseModel('qwen3:8b')

      await aiSettingsPage.test()
      await expect(aiSettingsPage.testResult).toHaveText('qwen3:8b answered.')
      await aiSettingsPage.save()
      await expect(aiSettingsPage.status).toHaveText('On · qwen3:8b')

      const api = await apiAs('admin')
      expect(await api.get<Settings>('/ai/settings')).toMatchObject({
        configured: true,
        provider: 'ollama_local',
        model: 'qwen3:8b',
        base_url: OLLAMA_ADDRESS,
        api_key_set: false,
      })
      const paths = (await harness.aiRequests()).map((request) => `${request.host}${request.path}`)
      expect(paths).toEqual(['host.docker.internal/api/tags', 'host.docker.internal/api/chat'])
    })

    test('Ollama on your computer: says when nothing answers at the address, and when it isn’t one', async ({
      aiSettingsPage,
    }) => {
      await aiSettingsPage.goto()
      await aiSettingsPage.chooseProvider('ollama_local')

      await aiSettingsPage.enterAddress('localhost:11434')
      await expect(aiSettingsPage.address).toContainText('Start it with http:// or https://')
      await expect(aiSettingsPage.fetchButton).toBeDisabled()

      await aiSettingsPage.enterAddress(OLLAMA_DOWN_ADDRESS)
      await aiSettingsPage.fetchModels()
      await expect(aiSettingsPage.fetchError).toContainText(
        `Cashcove can't reach Ollama at ${OLLAMA_DOWN_ADDRESS}`,
      )
      await expect(aiSettingsPage.fetchError).toContainText(
        'localhost there is the container itself',
      )
      await expect(aiSettingsPage.saveButton).toBeDisabled()
    })

    test('Ollama Cloud: the key is tried, its models are fetched and the one chosen is saved', async ({
      aiSettingsPage,
    }) => {
      await aiSettingsPage.goto()
      await aiSettingsPage.chooseProvider('ollama_cloud')
      await expect(aiSettingsPage.address).toHaveCount(0)
      // Nothing to fetch with until there's a key.
      await expect(aiSettingsPage.fetchButton).toBeDisabled()

      await aiSettingsPage.enterKey(AI_KEYS.ollama_cloud)
      await aiSettingsPage.fetchModels()
      await expect(aiSettingsPage.fetched).toContainText('Found 2 models that can chat')
      // Each says what it costs, from Ollama’s own price list.
      await aiSettingsPage.chooseModel('gpt-oss:120b')
      await expect(aiSettingsPage.model).toContainText('per million tokens')

      await aiSettingsPage.test()
      await expect(aiSettingsPage.testResult).toHaveText('gpt-oss:120b answered.')
      await aiSettingsPage.save()
      await expect(aiSettingsPage.status).toHaveText('On · gpt-oss:120b')
    })

    test('Ollama Cloud: a key that isn’t accepted is caught by the test', async ({
      aiSettingsPage,
    }) => {
      await aiSettingsPage.goto()
      await aiSettingsPage.chooseProvider('ollama_cloud')
      await aiSettingsPage.enterKey('not-the-key')
      await aiSettingsPage.fetchModels()

      await aiSettingsPage.chooseModel('gemma4:31b')
      await aiSettingsPage.test()

      await expect(aiSettingsPage.testResult).toContainText("The provider didn't accept the key")
    })

    test('a saved key is kept when the form leaves it blank, and forgotten for another provider', async ({
      aiSettingsPage,
      apiAs,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api, 'openai')

      await aiSettingsPage.goto()
      await expect(aiSettingsPage.status).toHaveText('On · GPT-6 Luna')
      // Changing only the model keeps the key that's saved.
      await aiSettingsPage.chooseModel('GPT-5.4 mini')
      await aiSettingsPage.test()
      await expect(aiSettingsPage.testResult).toHaveText('GPT-5.4 mini answered.')
      await aiSettingsPage.save()
      await expect(aiSettingsPage.status).toHaveText('On · GPT-5.4 mini')
      expect(await api.get<Settings>('/ai/settings')).toMatchObject({
        provider: 'openai',
        api_key_set: true,
      })

      // Another provider has no key of its own yet, so it can't be tried or saved without one.
      await aiSettingsPage.chooseProvider('anthropic')
      await expect(aiSettingsPage.testButton).toBeDisabled()
      await expect(aiSettingsPage.saveButton).toBeDisabled()
    })

    test('imports can be left without a second opinion', async ({ aiSettingsPage, apiAs }) => {
      const api = await apiAs('admin')
      await setUpAi(api, 'openai')
      await aiSettingsPage.goto()

      const toggle = aiSettingsPage.page.getByTestId('ai-review-imports').getByRole('checkbox')
      await expect(toggle).toBeChecked()
      await toggle.uncheck()
      await aiSettingsPage.save()

      await expect
        .poll(async () => (await api.get<Settings>('/ai/settings')).review_imports)
        .toBe(false)
    })

    test('turning AI off forgets the key, and the AI tab says to set it up again', async ({
      aiSettingsPage,
      aiPage,
      apiAs,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api, 'anthropic')
      await aiSettingsPage.goto()
      await expect(aiSettingsPage.status).toHaveText('On · Claude Haiku 4.5')

      await aiSettingsPage.turnOff()

      expect(await api.get<Settings>('/ai/settings')).toMatchObject({
        configured: false,
        provider: null,
        api_key_set: false,
      })
      await aiPage.goto()
      await expect(aiPage.setup).toBeVisible()
      await expect(aiPage.setupLink).toHaveAttribute('href', '/settings/ai')
    })
  })

  test.describe('as a viewer', () => {
    test.use({ storageState: signInFiles.viewer })

    test('sees how AI is set up and nothing to change it with', async ({
      aiSettingsPage,
      apiAs,
    }) => {
      const admin = await apiAs('admin')
      await setUpAi(admin, 'openai')

      await aiSettingsPage.goto()

      await expect(aiSettingsPage.page.getByTestId('read-only-notice')).toBeVisible()
      await expect(aiSettingsPage.status).toHaveText('On · GPT-6 Luna')
      await expect(aiSettingsPage.summary).toContainText('OpenAI')
      await expect(aiSettingsPage.summary).toContainText('GPT-6 Luna')
      await expect(aiSettingsPage.form).toHaveCount(0)

      // The server says no too, to the settings and to trying a key.
      const viewer = await apiAs('viewer')
      await expect(
        viewer.put('/ai/settings', {
          provider: 'openai',
          model: 'gpt-6-luna',
          base_url: null,
          api_key: 'another-key',
          review_imports: true,
        }),
      ).rejects.toThrow(/failed with 403/)
      await expect(
        viewer.post('/ai/test', {
          provider: 'openai',
          base_url: null,
          api_key: AI_KEYS.openai,
          model: 'gpt-6-luna',
        }),
      ).rejects.toThrow(/failed with 403/)
      await expect(viewer.delete('/ai/settings')).rejects.toThrow(/failed with 403/)
    })

    test('is told an admin can turn AI on, when it is off', async ({ aiSettingsPage }) => {
      await aiSettingsPage.goto()

      await expect(aiSettingsPage.status).toHaveText('Off')
      await expect(aiSettingsPage.summary).toContainText('An admin can turn it on here.')
    })
  })
})
