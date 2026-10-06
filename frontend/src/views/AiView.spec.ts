import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { aiOff, makeAiSettings, makeProviders, makeRecommendationPage, makeUsage } from '@/test/ai'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import AiView from '@/views/AiView.vue'

interface Options {
  route?: string
  settings?: api.AiSettings
  width?: number
  counts?: api.RecommendationCounts
}

async function render({
  route = '/ai',
  settings = makeAiSettings(),
  width = 1280,
  counts = { open: 0, applied: 0, dismissed: 0 },
}: Options = {}) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const fetchProviders = vi.spyOn(api, 'fetchAiProviders').mockResolvedValue(makeProviders())
  const fetchSettings = vi.spyOn(api, 'fetchAiSettings').mockResolvedValue(settings)
  vi.spyOn(api, 'fetchRecommendations').mockResolvedValue(makeRecommendationPage([], { counts }))
  vi.spyOn(api, 'fetchAiReviews').mockResolvedValue([])
  vi.spyOn(api, 'fetchAiUsage').mockResolvedValue(makeUsage())
  const mounted = await mountWithPlugins(AiView, {
    route,
    width,
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find, fetchProviders, fetchSettings }
}

describe('AiView', () => {
  it('opens on the chat, under a header and the tabs of the AI pages', async () => {
    const { wrapper, find } = await render()

    expect(wrapper.find('h1').text()).toBe('AI')
    expect(find('ai-chat').exists()).toBe(true)
    expect(find('ai-tab-ask').attributes('href')).toBe('/ai')
    expect(find('ai-tab-recommendations').attributes('href')).toBe('/ai/recommendations')
    expect(find('ai-tab-usage').attributes('href')).toBe('/ai/usage')
    expect(find('ai-tab-ask').attributes('aria-selected')).toBe('true')
    expect(find('ai-tab-usage').attributes('aria-selected')).toBe('false')
    expect(find('ai-setup').exists()).toBe(false)
  })

  it('says AI isn’t set up, rather than offering a chat that couldn’t answer', async () => {
    const { find } = await render({ settings: aiOff })

    expect(find('ai-setup').exists()).toBe(true)
    expect(find('ai-chat').exists()).toBe(false)
  })

  it('shows the suggestions, which are there to see whether or not AI is still set up', async () => {
    const { find } = await render({ route: '/ai/recommendations', settings: aiOff })

    expect(find('ai-recommendations').exists()).toBe(true)
    expect(find('ai-tab-recommendations').attributes('aria-selected')).toBe('true')
  })

  it('shows the usage', async () => {
    const { find } = await render({ route: '/ai/usage' })

    expect(find('ai-usage').exists()).toBe(true)
    expect(find('ai-tab-usage').attributes('aria-selected')).toBe('true')
  })

  it('falls back to the chat for a page it doesn’t have', async () => {
    const { find } = await render({ route: '/ai/nope' })

    expect(find('ai-chat').exists()).toBe(true)
  })

  it('counts the suggestions waiting on their tab, for everyone looking at it', async () => {
    const { find } = await render({ counts: { open: 4, applied: 1, dismissed: 0 } })

    expect(find('ai-tab-waiting').text()).toContain('4')
    expect(find('ai-tab-recommendations').text()).toContain('4 waiting')
  })

  it('has no badge when nothing is waiting', async () => {
    const { find } = await render()

    expect(find('ai-tab-waiting').exists()).toBe(false)
  })

  it('shows the tabs’ icons on a computer but not a phone', async () => {
    const wide = await render({ width: 1280 })
    expect(wide.find('ai-tab-ask').find('.v-icon').exists()).toBe(true)

    const narrow = await render({ width: 400 })
    expect(narrow.find('ai-tab-ask').find('.v-icon').exists()).toBe(false)
    expect(narrow.find('ai-tab-ask').text()).toBe('Ask')
  })

  it('shows a skeleton until the settings have loaded', async () => {
    vi.spyOn(api, 'fetchAiProviders').mockReturnValue(new Promise(() => undefined))
    vi.spyOn(api, 'fetchAiSettings').mockReturnValue(new Promise(() => undefined))
    vi.spyOn(api, 'fetchRecommendations').mockResolvedValue(makeRecommendationPage([]))
    const { wrapper } = await mountWithPlugins(AiView, {
      route: '/ai',
      beforeMount: () => seedFinance(),
    })

    expect(wrapper.find('[data-test="ai-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-chat"]').exists()).toBe(false)
  })

  it('says when the settings can’t be loaded, and loads them again', async () => {
    vi.spyOn(api, 'fetchAiProviders').mockRejectedValueOnce(
      new ApiError(0, 'Can’t reach Cashcove.', { code: 'offline' }),
    )
    vi.spyOn(api, 'fetchAiProviders').mockResolvedValue(makeProviders())
    vi.spyOn(api, 'fetchAiSettings').mockResolvedValue(makeAiSettings())
    vi.spyOn(api, 'fetchRecommendations').mockResolvedValue(makeRecommendationPage([]))
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    const { wrapper } = await mountWithPlugins(AiView, {
      route: '/ai',
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    expect(wrapper.find('[data-test="ai-error"]').text()).toContain(
      "Couldn't load the AI settings.",
    )

    await wrapper.find('[data-test="ai-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="ai-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ai-chat"]').exists()).toBe(true)
  })
})
