import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { useAiStore } from '@/stores/ai'
import { makeAiSettings, makeProviders, makeReview } from '@/test/ai'
import { mountWithPlugins } from '@/test/mount'
import * as dates from '@/utils/dates'
import ReviewDialog from '@/views/ai/ReviewDialog.vue'

async function render(open = true) {
  vi.spyOn(dates, 'todayIso').mockReturnValue('2026-09-20')
  const mounted = await mountWithPlugins(ReviewDialog, {
    props: { modelValue: open, 'onUpdate:modelValue': () => undefined },
    beforeMount: () => {
      const ai = useAiStore()
      ai.providers = makeProviders()
      ai.settings = makeAiSettings()
    },
  })
  await flushPromises()
  // The dialog is drawn into the page, outside the component.
  const find = (name: string) => document.body.querySelector<HTMLElement>(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('ReviewDialog', () => {
  it('asks which transactions, saying what it looks at and what it costs in requests', async () => {
    const { find } = await render()

    expect(document.body.textContent).toContain('Review transactions')
    expect(find('review-scope')).not.toBeNull()
    expect(find('review-days')).not.toBeNull()
    expect(find('review-limit')).not.toBeNull()
    expect(find('review-explain')?.textContent).toContain(
      'A category you chose yourself is never reviewed.',
    )
    expect(find('review-explain')?.textContent).toContain('2 requests to GPT-6 Luna')
    expect(find('ai-privacy')).not.toBeNull()
  })

  it('starts the review it was asked for, and says it has started', async () => {
    const started = makeReview({ id: 'new', status: 'pending', reviewed: 0 })
    const start = vi.spyOn(api, 'startAiReview').mockResolvedValue(started)
    const { wrapper, find } = await render()

    find('review-start')!.click()
    await flushPromises()

    expect(start).toHaveBeenCalledWith({
      scope: 'recent',
      days: 30,
      limit: 50,
      today: '2026-09-20',
    })
    expect(wrapper.emitted('started')).toEqual([[started]])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('asks for the days and the number that were chosen', async () => {
    const start = vi.spyOn(api, 'startAiReview').mockResolvedValue(makeReview())
    const { wrapper, find } = await render()
    const [days, limit] = wrapper.findAllComponents({ name: 'VSelect' })

    await days!.setValue(90)
    await limit!.setValue(100)

    expect(find('review-explain')?.textContent).toContain('3 requests to GPT-6 Luna')
    find('review-start')!.click()
    await flushPromises()
    expect(start).toHaveBeenCalledWith({
      scope: 'recent',
      days: 90,
      limit: 100,
      today: '2026-09-20',
    })
  })

  it('can be limited to the uncategorized, which has no days to choose', async () => {
    const start = vi.spyOn(api, 'startAiReview').mockResolvedValue(makeReview())
    const { wrapper, find } = await render()

    const buttons = find('review-scope')!.querySelectorAll('button')
    buttons[1]!.click()
    await flushPromises()

    expect(find('review-days')).toBeNull()
    find('review-start')!.click()
    await flushPromises()
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'uncategorized', limit: 50 }),
    )
    expect(wrapper.emitted('started')).toHaveLength(1)
  })

  it('shows why it couldn’t start, and starts fresh when it is opened again', async () => {
    vi.spyOn(api, 'startAiReview').mockRejectedValue(
      new ApiError(409, 'AI isn’t set up yet.', { code: 'ai_not_configured' }),
    )
    const { wrapper, find } = await render()

    find('review-start')!.click()
    await flushPromises()

    expect(find('review-error')?.textContent).toContain('AI isn’t set up yet.')
    expect(wrapper.emitted('started')).toBeUndefined()

    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(find('review-error')).toBeNull()
  })

  it('closes with Escape', async () => {
    const { wrapper } = await render()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('can be cancelled', async () => {
    const { wrapper, find } = await render()

    find('review-cancel')!.click()
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.emitted('started')).toBeUndefined()
  })
})
