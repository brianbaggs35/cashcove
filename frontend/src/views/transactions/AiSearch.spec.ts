import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { useAiStore } from '@/stores/ai'
import { makeAiSettings, makeProviders, makeSearchResult } from '@/test/ai'
import { later } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import * as dates from '@/utils/dates'
import AiSearch from '@/views/transactions/AiSearch.vue'

async function render(open = true) {
  vi.spyOn(dates, 'todayIso').mockReturnValue('2026-09-20')
  const mounted = await mountWithPlugins(AiSearch, {
    props: { open },
    beforeMount: () => {
      const ai = useAiStore()
      ai.providers = makeProviders()
      ai.settings = makeAiSettings()
    },
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  const input = () => find('ai-search-input').find('input')
  const type = async (text: string) => {
    await input().setValue(text)
  }
  const submit = () => find('ai-search-find').trigger('click')
  return { ...mounted, find, input, type, submit }
}

describe('AiSearch', () => {
  it('has nothing to show until it is opened, and then takes what is typed', async () => {
    const closed = await render(false)
    expect(closed.find('ai-search').exists()).toBe(false)
    closed.wrapper.unmount()

    const { find, input } = await render()
    expect(find('ai-search').text()).toContain('Find with AI')
    expect(input().attributes('placeholder')).toBe('Groceries over $50 last month')
    expect(find('ai-search').text()).toContain('Only what you type and your category names')
    expect(find('ai-search-find').attributes('disabled')).toBeDefined()
  })

  it('puts the cursor in the box when it opens', async () => {
    const { wrapper, input } = await render(false)

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(document.activeElement).toBe(input().element)
  })

  it('closes from its own button', async () => {
    const { wrapper, find } = await render()

    await find('ai-search-close').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('asks what was typed, with today’s date, and hands on the filters it came to', async () => {
    const result = makeSearchResult()
    const ask = vi.spyOn(api, 'searchWithAi').mockResolvedValue(result)
    const { wrapper, find, type, submit } = await render()
    await type('  groceries over $50 last month  ')

    await submit()
    await flushPromises()

    expect(ask).toHaveBeenCalledExactlyOnceWith('groceries over $50 last month', '2026-09-20')
    expect(wrapper.emitted('found')).toEqual([[result]])
    expect(find('ai-search-result').text()).toContain(
      'Showing what matches “groceries over $50 last month”.',
    )
    expect(find('ai-search-ignored').exists()).toBe(false)
    expect(find('ai-search-working').exists()).toBe(false)
  })

  it('searches when Enter is pressed in the box', async () => {
    const ask = vi.spyOn(api, 'searchWithAi').mockResolvedValue(makeSearchResult())
    const { find, type } = await render()
    await type('coffee')

    await find('ai-search').find('form').trigger('submit')
    await flushPromises()

    expect(ask).toHaveBeenCalledOnce()
  })

  it('says what it couldn’t use', async () => {
    vi.spyOn(api, 'searchWithAi').mockResolvedValue(
      makeSearchResult({ ignored: ['birthday', 'the category “Hobbies”'] }),
    )
    const { find, type, submit } = await render()
    await type('hobbies for a birthday')

    await submit()
    await flushPromises()

    expect(find('ai-search-ignored').text()).toBe('Couldn’t use: birthday, the category “Hobbies”.')
  })

  it('says so, and changes nothing, when there was no filter in it', async () => {
    vi.spyOn(api, 'searchWithAi').mockResolvedValue(
      makeSearchResult(
        { ignored: ['blue'] },
        {
          category_ids: [],
          start: null,
          end: null,
          direction: null,
          min_amount: null,
        },
      ),
    )
    const { wrapper, find, type, submit } = await render()
    await type('something blue')

    await submit()
    await flushPromises()

    expect(find('ai-search-nothing').text()).toContain('There was no filter in that.')
    expect(find('ai-search-nothing').text()).toContain('Couldn’t use: blue.')
    expect(find('ai-search-result').exists()).toBe(false)
    expect(wrapper.emitted('found')).toBeUndefined()
  })

  it('says what the AI is doing, and what stays private, while it works', async () => {
    const answer = later<api.SearchResult>()
    vi.spyOn(api, 'searchWithAi').mockReturnValue(answer.promise)
    const { find, type, submit } = await render()
    await type('coffee')

    await submit()

    expect(find('ai-progress-stage').text()).toBe('Working out the filters…')
    expect(find('ai-progress-privacy').text()).toBe(
      'Only what you typed, with account details taken out, and your category names go to GPT-6 Luna. The accounts you name are found here.',
    )
    // Kept as it is rather than dimmed, which would leave its hint too faint to read.
    expect(find('ai-search-input').find('input').attributes('readonly')).toBeDefined()
    expect(find('ai-search-input').find('input').attributes('disabled')).toBeUndefined()
    expect(find('ai-search-find').classes()).toContain('v-btn--loading')
    expect(find('ai-search-find').find('.v-progress-circular').attributes('aria-hidden')).toBe(
      'true',
    )

    answer.resolve(makeSearchResult())
    await flushPromises()
    expect(find('ai-search-working').exists()).toBe(false)
  })

  it('says the AI when it doesn’t know which model it is', async () => {
    vi.spyOn(api, 'searchWithAi').mockReturnValue(later<api.SearchResult>().promise)
    const { find, type, submit } = await render()
    useAiStore().settings = makeAiSettings({ model: null })
    await type('coffee')

    await submit()

    expect(find('ai-progress-privacy').text()).toContain('and your category names go to the AI.')
  })

  it('can be stopped, and then ignores the answer that comes', async () => {
    const answer = later<api.SearchResult>()
    vi.spyOn(api, 'searchWithAi').mockReturnValue(answer.promise)
    const { wrapper, find, type, submit } = await render()
    await type('coffee')
    await submit()

    await find('ai-search-stop').trigger('click')
    expect(find('ai-search-working').exists()).toBe(false)
    answer.resolve(makeSearchResult())
    await flushPromises()

    expect(wrapper.emitted('found')).toBeUndefined()
    expect(find('ai-search-result').exists()).toBe(false)
  })

  it('ignores a failure that comes after it was stopped', async () => {
    const answer = later<api.SearchResult>()
    vi.spyOn(api, 'searchWithAi').mockReturnValue(answer.promise)
    const { find, type, submit } = await render()
    await type('coffee')
    await submit()

    await find('ai-search-stop').trigger('click')
    answer.reject(new Error('Offline'))
    await flushPromises()

    expect(find('ai-search-error').exists()).toBe(false)
  })

  it('says why it failed, and can be tried again', async () => {
    const ask = vi
      .spyOn(api, 'searchWithAi')
      .mockRejectedValueOnce(
        new ApiError(502, 'The AI didn’t answer in time.', { code: 'ai_unreachable' }),
      )
      .mockResolvedValueOnce(makeSearchResult())
    const { wrapper, find, type, submit } = await render()
    await type('coffee')

    await submit()
    await flushPromises()
    expect(find('ai-search-error').text()).toBe('The AI didn’t answer in time.')

    await submit()
    await flushPromises()

    expect(ask).toHaveBeenCalledTimes(2)
    expect(find('ai-search-error').exists()).toBe(false)
    expect(wrapper.emitted('found')).toHaveLength(1)
  })

  it('asks nothing for an empty box, or while it is already asking', async () => {
    const answer = later<api.SearchResult>()
    const ask = vi.spyOn(api, 'searchWithAi').mockReturnValue(answer.promise)
    const { find, type, submit } = await render()

    await find('ai-search').find('form').trigger('submit')
    expect(ask).not.toHaveBeenCalled()

    await type('coffee')
    await submit()
    await find('ai-search').find('form').trigger('submit')

    expect(ask).toHaveBeenCalledOnce()
  })
})
