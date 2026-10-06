import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { notices } from '@/composables/notify'
import { polling, POLL_INTERVAL } from '@/composables/useReviewProgress'
import { makeRecommendation, makeRecommendationPage, makeReview } from '@/test/ai'
import { seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import ImportAiStep from '@/views/import/ImportAiStep.vue'

const notes = ['Imported 3 transactions · Sep 1 – 3, 2026.', 'Your automations sorted 2 of them.']
const coffee = makeRecommendation()
const target = makeRecommendation({
  id: 'recommendation-target',
  payee: 'Target',
  confidence: 'low',
  suggested_category_id: 'category-groceries',
})

interface Options {
  review?: api.AiReview
  page?: api.RecommendationPage
  role?: 'admin' | 'viewer'
}

async function render({
  review = makeReview({ id: 'review-import', source: 'import', open: 2, applied: 0, dismissed: 0 }),
  page = makeRecommendationPage([coffee, target], { total: 2 }),
  role = 'admin',
}: Options = {}) {
  const fetchReview = vi.spyOn(api, 'fetchAiReview').mockResolvedValue(review)
  const fetchList = vi.spyOn(api, 'fetchRecommendations').mockResolvedValue(page)
  const mounted = await mountWithPlugins(ImportAiStep, {
    session: makeSessionState({ user: makeUser({ role }) }),
    props: { reviewId: 'review-import', notes },
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find, fetchReview, fetchList }
}

describe('ImportAiStep', () => {
  beforeEach(() => {
    notices.value = []
    polling.interval = 10
  })
  afterEach(() => {
    polling.interval = POLL_INTERVAL
  })

  it('says what importing did and shows the AI at work, which can be left to finish', async () => {
    const { find, fetchList } = await render({
      review: makeReview({ id: 'review-import', status: 'running', reviewed: 20, total: 40 }),
    })

    expect(find('import-ai-notes').text()).toContain('Imported 3 transactions')
    expect(find('import-ai-notes').text()).toContain('Your automations sorted 2 of them.')
    expect(find('review-progress').text()).toContain('Reviewed 20 of 40 transactions…')
    expect(find('import-ai-wait').text()).toContain('wait for you on the AI tab')
    expect(find('recommendation-list').exists()).toBe(false)
    expect(fetchList).not.toHaveBeenCalled()
  })

  it('lists the suggestions once the AI has finished, and says it has', async () => {
    const { wrapper, find, fetchList } = await render()

    expect(wrapper.emitted('finished')).toHaveLength(1)
    expect(fetchList).toHaveBeenCalledWith({
      review_id: 'review-import',
      status: 'open',
      page_size: 50,
    })
    expect(find('import-ai-summary').text()).toBe(
      'The AI has 2 suggestions for how these were sorted. Nothing changes until you apply one.',
    )
    expect(wrapper.findAll('[data-test="recommendation"]')).toHaveLength(2)
    expect(find('import-ai-wait').exists()).toBe(false)
  })

  it('says one suggestion in the singular', async () => {
    const { find } = await render({
      review: makeReview({ id: 'review-import', open: 1, applied: 0, dismissed: 0 }),
      page: makeRecommendationPage([coffee], { total: 1 }),
    })

    expect(find('import-ai-summary').text()).toContain('The AI has 1 suggestion for')
  })

  it('applies all of them in one go', async () => {
    const apply = vi
      .spyOn(api, 'applyRecommendations')
      .mockResolvedValue({ changed: 2, skipped: 0 })
    const { find, fetchList } = await render()
    expect(find('import-ai-apply-all').text()).toBe('Apply all 2')

    await find('import-ai-apply-all').trigger('click')
    await flushPromises()

    expect(apply).toHaveBeenCalledWith(['recommendation-coffee', 'recommendation-target'])
    expect(notices.value.map((notice) => notice.text)).toEqual(['Applied 2 suggestions.'])
    expect(fetchList).toHaveBeenCalledTimes(2)
  })

  it('dismisses all of them in one go', async () => {
    const dismiss = vi
      .spyOn(api, 'dismissRecommendations')
      .mockResolvedValue({ changed: 2, skipped: 0 })
    const { find } = await render()

    await find('import-ai-dismiss-all').trigger('click')
    await flushPromises()

    expect(dismiss).toHaveBeenCalledWith(['recommendation-coffee', 'recommendation-target'])
  })

  it('applies or dismisses the ones ticked', async () => {
    const apply = vi
      .spyOn(api, 'applyRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const dismiss = vi
      .spyOn(api, 'dismissRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const { wrapper, find } = await render()
    await wrapper.findAll('[data-test="recommendation-select"] input')[1]!.setValue(true)

    expect(find('import-ai-apply-all').exists()).toBe(false)
    expect(find('import-ai-apply-selected').text()).toBe('Apply 1')
    await find('import-ai-apply-selected').trigger('click')
    await flushPromises()
    expect(apply).toHaveBeenCalledWith(['recommendation-target'])

    await wrapper.findAll('[data-test="recommendation-select"] input')[0]!.setValue(true)
    await find('import-ai-dismiss-selected').trigger('click')
    await flushPromises()
    expect(dismiss).toHaveBeenCalledWith(['recommendation-coffee'])
  })

  it('applies or dismisses one from its own buttons', async () => {
    const apply = vi
      .spyOn(api, 'applyRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const dismiss = vi
      .spyOn(api, 'dismissRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const { wrapper } = await render()

    await wrapper.find('[data-test="reco-apply"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-test="reco-dismiss"]')[1]!.trigger('click')
    await flushPromises()

    expect(apply).toHaveBeenCalledWith(['recommendation-coffee'])
    expect(dismiss).toHaveBeenCalledWith(['recommendation-target'])
  })

  it('says what went wrong when a decision fails', async () => {
    vi.spyOn(api, 'applyRecommendations').mockRejectedValue(new Error('Offline'))
    const { find } = await render()

    await find('import-ai-apply-all').trigger('click')
    await flushPromises()

    expect(find('import-ai-decide-error').text()).toBe('Offline')
  })

  it('says so, when everything has been decided', async () => {
    const apply = vi
      .spyOn(api, 'applyRecommendations')
      .mockResolvedValue({ changed: 2, skipped: 0 })
    const { find, fetchList } = await render()
    fetchList.mockResolvedValue(makeRecommendationPage([], { total: 0 }))

    await find('import-ai-apply-all').trigger('click')
    await flushPromises()

    expect(apply).toHaveBeenCalledTimes(1)
    expect(find('import-ai-decided').text()).toContain(
      'You’ve been through everything the AI suggested.',
    )
    expect(find('recommendation-list').exists()).toBe(false)
  })

  it('says the AI agrees when it has nothing to suggest', async () => {
    const { find } = await render({
      review: makeReview({
        id: 'review-import',
        total: 3,
        reviewed: 3,
        open: 0,
        applied: 0,
        dismissed: 0,
      }),
      page: makeRecommendationPage([], { total: 0 }),
    })

    expect(find('import-ai-agrees').text()).toBe(
      'The AI agrees with how all 3 transactions were sorted.',
    )
    expect(find('import-ai-decided').exists()).toBe(false)
  })

  it('points to the AI tab for the rest when there are more than are listed', async () => {
    const { find } = await render({
      page: makeRecommendationPage([coffee], { total: 120 }),
      review: makeReview({ id: 'review-import', open: 120, applied: 0, dismissed: 0 }),
    })

    expect(find('import-ai-more').text()).toContain('Showing the first 1 of 120.')
    expect(find('import-ai-more').find('a').attributes('href')).toBe(
      '/ai/recommendations?review=review-import',
    )
  })

  it('doesn’t point there when everything is listed', async () => {
    const { find } = await render()

    expect(find('import-ai-more').exists()).toBe(false)
  })

  it('says why the AI stopped, and what it got through', async () => {
    const { find } = await render({
      review: makeReview({
        id: 'review-import',
        status: 'failed',
        error: 'The provider didn’t accept the key.',
        reviewed: 10,
        total: 40,
      }),
    })

    expect(find('review-failed').text()).toContain('The provider didn’t accept the key.')
    expect(find('recommendation-list').exists()).toBe(false)
    expect(find('import-ai-agrees').exists()).toBe(false)
  })

  it('watches the review until it is done, and then shows what it found', async () => {
    const running = makeReview({ id: 'review-import', status: 'running', reviewed: 20, total: 40 })
    const done = makeReview({
      id: 'review-import',
      status: 'done',
      total: 40,
      reviewed: 40,
      open: 2,
    })
    // It stays as it is until the test says it has finished, however slowly the test goes.
    const fetchReview = vi.spyOn(api, 'fetchAiReview').mockResolvedValue(running)
    vi.spyOn(api, 'fetchRecommendations').mockResolvedValue(
      makeRecommendationPage([coffee, target], { total: 2 }),
    )
    const { wrapper } = await mountWithPlugins(ImportAiStep, {
      props: { reviewId: 'review-import', notes },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()
    expect(wrapper.find('[data-test="review-progress"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="recommendation-list"]').exists()).toBe(false)

    fetchReview.mockResolvedValue(done)
    await vi.waitFor(() => {
      expect(wrapper.findAll('[data-test="recommendation"]')).toHaveLength(2)
    })

    expect(fetchReview.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(wrapper.emitted('finished')).toHaveLength(1)
  })

  it('says when it can’t check on the AI', async () => {
    vi.spyOn(api, 'fetchAiReview').mockRejectedValue(new Error('Offline'))
    const { wrapper } = await mountWithPlugins(ImportAiStep, {
      props: { reviewId: 'review-import', notes },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    expect(wrapper.find('[data-test="import-ai-error"]').text()).toContain(
      "Couldn't check on the AI. Offline",
    )
  })

  it('says when the suggestions can’t be loaded', async () => {
    vi.spyOn(api, 'fetchAiReview').mockResolvedValue(
      makeReview({ id: 'review-import', open: 2, applied: 0, dismissed: 0 }),
    )
    vi.spyOn(api, 'fetchRecommendations').mockRejectedValue(new Error('Suggestions offline'))
    const { wrapper } = await mountWithPlugins(ImportAiStep, {
      props: { reviewId: 'review-import', notes },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    expect(wrapper.find('[data-test="import-ai-load-error"]').text()).toContain(
      "Couldn't load the suggestions. Suggestions offline",
    )
    expect(wrapper.find('[data-test="recommendation-list"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="import-ai-decided"]').exists()).toBe(false)
  })

  it('lets a viewer see the suggestions without deciding on them', async () => {
    const { wrapper, find } = await render({ role: 'viewer' })

    expect(wrapper.findAll('[data-test="recommendation"]')).toHaveLength(2)
    expect(find('import-ai-apply-all').exists()).toBe(false)
    expect(find('import-ai-dismiss-all').exists()).toBe(false)
    expect(find('reco-apply').exists()).toBe(false)
  })
})
