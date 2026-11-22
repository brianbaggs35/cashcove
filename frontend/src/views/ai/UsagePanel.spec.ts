import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { confirmRequest } from '@/composables/confirm'
import { useAiStore } from '@/stores/ai'
import { notices } from '@/composables/notify'
import { aiOff, makeAiSettings, makeProviders, makeUsage } from '@/test/ai'
import { answer } from '@/test/confirm'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import UsagePanel from '@/views/ai/UsagePanel.vue'

interface Options {
  usage?: api.AiUsage
  settings?: api.AiSettings
  width?: number
}

async function render({
  usage = makeUsage(),
  settings = makeAiSettings(),
  width = 1280,
}: Options = {}) {
  const fetch = vi.spyOn(api, 'fetchAiUsage').mockResolvedValue(usage)
  const mounted = await mountWithPlugins(UsagePanel, {
    width,
    beforeMount: () => {
      seedFinance()
      const ai = useAiStore()
      ai.providers = makeProviders()
      ai.settings = settings
    },
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find, fetch }
}

describe('UsagePanel', () => {
  it('shows this month, the range, and the tokens it was sent and sent back', async () => {
    const { find, fetch } = await render()

    expect(fetch).toHaveBeenCalledWith(30)
    expect(find('usage-tile-month').text()).toContain('This month')
    expect(find('usage-tile-month').text()).toContain('$0.02')
    expect(find('usage-tile-month').text()).toContain('19 calls')
    expect(find('usage-tile-range').text()).toContain('Last 30 days')
    expect(find('usage-tile-range').text()).toContain('$0.0058')
    expect(find('usage-tile-range').text()).toContain('7 calls')
    expect(find('usage-tile-in').text()).toContain('42K')
    expect(find('usage-tile-out').text()).toContain('3.1K')
  })

  it('shows the cost day by day, and by model and by what it was for', async () => {
    const { wrapper, find } = await render()

    expect(find('usage-chart').exists()).toBe(true)
    const tables = wrapper.findAll('[data-test="usage-table"]')
    expect(tables).toHaveLength(2)
    expect(tables[0]!.text()).toContain('GPT-6 Luna (OpenAI)')
    expect(tables[0]!.text()).toContain('gemma4:31b (Ollama Cloud)')
    expect(tables[1]!.text()).toContain('Questions in the AI tab')
    expect(tables[1]!.text()).toContain('Second opinions on categories')
  })

  it('looks at another range when asked', async () => {
    const { find, fetch } = await render()

    await find('usage-range').findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(7)
    expect(find('usage-tile-range').text()).toContain('Last 7 days')

    await find('usage-range').findAll('button')[2]!.trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(90)

    await find('usage-range').findAll('button')[3]!.trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(365)
    expect(find('usage-tile-range').text()).toContain('Last 365 days')
  })

  describe('what a bar stands for', () => {
    const pressed = (find: Awaited<ReturnType<typeof render>>['find']) =>
      ['day', 'week', 'month'].filter((name) =>
        find(`usage-grouping-${name}`).classes().includes('v-btn--active'),
      )
    const disabled = (find: Awaited<ReturnType<typeof render>>['find']) =>
      ['day', 'week', 'month'].filter(
        (name) => find(`usage-grouping-${name}`).attributes('disabled') !== undefined,
      )
    const range = async (rendered: Awaited<ReturnType<typeof render>>, index: number) => {
      await rendered.find('usage-range').findAll('button')[index]!.trigger('click')
      await flushPromises()
    }

    it('is a day for a short range, a week for a quarter and a month for a year', async () => {
      const rendered = await render()

      expect(pressed(rendered.find)).toEqual(['day'])
      expect(rendered.find('usage-scrub').attributes('aria-label')).toContain('one day at a time')
      await range(rendered, 2)
      expect(pressed(rendered.find)).toEqual(['week'])
      expect(rendered.find('usage-scrub').attributes('aria-label')).toContain('one week at a time')
      await range(rendered, 3)
      expect(pressed(rendered.find)).toEqual(['month'])
    })

    it('can’t be a day when there would be too many days to tell apart', async () => {
      const rendered = await render()

      expect(disabled(rendered.find)).toEqual([])
      await range(rendered, 2)
      expect(disabled(rendered.find)).toEqual(['day'])
      await range(rendered, 3)
      expect(disabled(rendered.find)).toEqual(['day'])
    })

    it('is what was chosen, for as long as the range can be shown that way', async () => {
      const rendered = await render()

      await rendered.find('usage-grouping-week').trigger('click')
      expect(pressed(rendered.find)).toEqual(['week'])
      expect(rendered.find('usage-scrub').attributes('aria-label')).toContain('one week at a time')
      // A week suits a year too, so it stays.
      await range(rendered, 3)
      expect(pressed(rendered.find)).toEqual(['week'])

      await rendered.find('usage-grouping-month').trigger('click')
      expect(pressed(rendered.find)).toEqual(['month'])
      await range(rendered, 0)
      expect(pressed(rendered.find)).toEqual(['month'])
    })

    it('goes back to what suits the range when what was chosen would be too many bars', async () => {
      const rendered = await render()

      await rendered.find('usage-grouping-day').trigger('click')
      await range(rendered, 2)
      expect(pressed(rendered.find)).toEqual(['week'])

      // And it is a day again where a day can be shown, as it was chosen.
      await range(rendered, 0)
      expect(pressed(rendered.find)).toEqual(['day'])
    })

    it('keeps the figures along the top the same', async () => {
      const { find } = await render()

      await find('usage-grouping-month').trigger('click')

      expect(find('usage-tile-range').text()).toContain('Last 30 days')
      expect(find('usage-tile-range').text()).toContain('7 calls')
    })
  })

  describe('clearing it', () => {
    it('asks first, and says what is forgotten and what stays', async () => {
      const clear = vi.spyOn(api, 'clearAiUsage').mockResolvedValue({ cleared: 12 })
      const { find } = await render()

      await find('usage-clear').trigger('click')

      expect(confirmRequest.value).toMatchObject({
        title: 'Clear the AI usage?',
        confirmText: 'Clear usage',
        tone: 'error',
      })
      expect(confirmRequest.value?.text).toContain('Every call counted so far is forgotten')
      expect(confirmRequest.value?.text).toContain(
        'Your chats, suggestions and AI settings are kept',
      )
      expect(confirmRequest.value?.text).toContain('can’t be undone')
      await answer(false)
      expect(clear).not.toHaveBeenCalled()
      expect(notices.value).toHaveLength(0)
    })

    it('clears it when confirmed, says how many calls, and counts again from zero', async () => {
      const clear = vi.spyOn(api, 'clearAiUsage').mockResolvedValue({ cleared: 12 })
      const { find, fetch } = await render()
      fetch.mockResolvedValue(
        makeUsage({
          totals: { calls: 0, input_tokens: 0, output_tokens: 0, cost_micros: 0 },
          this_month: { calls: 0, input_tokens: 0, output_tokens: 0, cost_micros: 0 },
          models: [],
          purposes: [],
        }),
      )

      await find('usage-clear').trigger('click')
      await answer(true)

      expect(clear).toHaveBeenCalledTimes(1)
      expect(notices.value.at(-1)).toMatchObject({
        text: 'Cleared the usage: 12 calls',
        tone: 'success',
      })
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(find('usage-tile-month').text()).toContain('0 calls')
      expect(find('usage-no-models').exists()).toBe(true)
    })

    it('says so for one call, and for none', async () => {
      const clear = vi.spyOn(api, 'clearAiUsage').mockResolvedValue({ cleared: 1 })
      const { find } = await render()

      await find('usage-clear').trigger('click')
      await answer(true)
      expect(notices.value.at(-1)?.text).toBe('Cleared the usage: 1 call')

      clear.mockResolvedValue({ cleared: 0 })
      await find('usage-clear').trigger('click')
      await answer(true)
      expect(notices.value.at(-1)).toMatchObject({
        text: 'There was no usage to clear',
        tone: 'info',
      })
    })

    it('counts in the household’s way', async () => {
      vi.spyOn(api, 'clearAiUsage').mockResolvedValue({ cleared: 12_345 })
      const { find } = await render()

      await find('usage-clear').trigger('click')
      await answer(true)

      expect(notices.value.at(-1)?.text).toBe('Cleared the usage: 12,345 calls')
    })

    it('has nothing to clear until the usage has loaded', async () => {
      vi.spyOn(api, 'fetchAiUsage').mockRejectedValue(new Error('Offline'))
      const { wrapper } = await mountWithPlugins(UsagePanel, { beforeMount: () => seedFinance() })
      await flushPromises()

      expect(wrapper.find('[data-test="usage-clear"]').attributes('disabled')).toBeDefined()
    })
  })

  it('says how many calls aren’t in the cost, because their model has no price', async () => {
    const one = await render({ usage: makeUsage({ unpriced_calls: 1 }) })
    expect(one.find('usage-unpriced').text()).toContain('1 call isn’t in the cost')

    const several = await render({ usage: makeUsage({ unpriced_calls: 12 }) })
    expect(several.find('usage-unpriced').text()).toContain('12 calls aren’t in the cost')

    const none = await render()
    expect(none.find('usage-unpriced').exists()).toBe(false)
  })

  it('says so when nothing has been asked in a range', async () => {
    const { find } = await render({ usage: makeUsage({ models: [], purposes: [] }) })

    expect(find('usage-no-models').text()).toBe('No model has been used in this time.')
    expect(find('usage-no-purposes').text()).toBe('Nothing has been asked in this time.')
    expect(find('usage-table').exists()).toBe(false)
  })

  describe('how the cost is worked out', () => {
    it('says which model it is and what it costs, with a link to each provider’s price list', async () => {
      const { find } = await render()

      expect(find('usage-model').text()).toBe(
        'You’re using GPT-6 Luna, at $0.10 in · $0.50 out per million tokens.',
      )
      expect(find('pricing-anthropic').attributes('href')).toBe(
        'https://platform.claude.com/docs/en/about-claude/pricing',
      )
      expect(find('pricing-openai').attributes('href')).toBe(
        'https://developers.openai.com/api/docs/pricing',
      )
      expect(find('pricing-ollama_cloud').attributes('href')).toBe('https://ollama.com/pricing')
      for (const name of ['anthropic', 'openai', 'ollama_cloud']) {
        expect(find(`pricing-${name}`).attributes('target')).toBe('_blank')
        expect(find(`pricing-${name}`).attributes('rel')).toBe('noopener noreferrer')
      }
      expect(find('usage-pricing').text()).toContain(
        'It’s an estimate: your provider’s bill is what counts.',
      )
      expect(find('usage-pricing').text()).toContain('Days are UTC days.')
    })

    it('says a model it has no price for without one', async () => {
      const { find } = await render({
        settings: makeAiSettings({ provider: 'ollama_cloud', model: 'gemma4:31b' }),
      })

      expect(find('usage-model').exists()).toBe(false)
      expect(find('usage-free-note').exists()).toBe(false)
    })

    it('says a price is missing when the model hasn’t got one', async () => {
      const { find } = await render({
        settings: makeAiSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' }),
      })

      expect(find('usage-model').text()).toContain('Claude Sonnet 5.5')
      expect(find('usage-model').text()).toContain('$2.00 in · $10.00 out per million tokens')
    })

    it('says Ollama on your own computer costs nothing', async () => {
      const { find } = await render({
        settings: makeAiSettings({ provider: 'ollama_local', model: 'llama3.2:3b' }),
      })

      expect(find('usage-free-note').text()).toContain('costs nothing')
      expect(find('usage-model').exists()).toBe(false)
    })

    it('says nothing about a model when AI is off', async () => {
      const { find } = await render({ settings: aiOff })

      expect(find('usage-model').exists()).toBe(false)
      expect(find('usage-free-note').exists()).toBe(false)
      expect(find('usage-pricing').exists()).toBe(true)
    })
  })

  it('shows a skeleton while it loads', async () => {
    vi.spyOn(api, 'fetchAiUsage').mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await mountWithPlugins(UsagePanel, { beforeMount: () => seedFinance() })

    expect(wrapper.find('[data-test="usage-loading"]').exists()).toBe(true)
  })

  it('says when it can’t load, and tries again', async () => {
    const fetch = vi
      .spyOn(api, 'fetchAiUsage')
      .mockRejectedValueOnce(new ApiError(0, 'Can’t reach Cashcove.', { code: 'offline' }))
      .mockResolvedValue(makeUsage())
    const { wrapper } = await mountWithPlugins(UsagePanel, { beforeMount: () => seedFinance() })
    await flushPromises()

    expect(wrapper.find('[data-test="usage-error"]').text()).toContain("Couldn't load the usage.")
    expect(wrapper.find('[data-test="usage-tile-month"]').exists()).toBe(false)

    await wrapper.find('[data-test="usage-retry"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-test="usage-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="usage-tile-month"]').exists()).toBe(true)
  })

  it('keeps what it has when a later range can’t be loaded', async () => {
    const { wrapper, find, fetch } = await render()
    fetch.mockRejectedValueOnce(new Error('Offline'))

    await find('usage-range').findAll('button')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="usage-error"]').text()).toContain('Offline')
    expect(find('usage-tile-month').exists()).toBe(true)
  })

  it('fits a phone', async () => {
    const { find } = await render({ width: 400 })

    expect(find('usage-tile-month').exists()).toBe(true)
    expect(find('usage-range').exists()).toBe(true)
  })
})
