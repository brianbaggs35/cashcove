import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { notices } from '@/composables/notify'
import { POLL_INTERVAL, polling } from '@/composables/useReviewProgress'
import { useAiStore } from '@/stores/ai'
import {
  aiOff,
  makeAiSettings,
  makeProviders,
  makeRecommendation,
  makeRecommendationPage,
  makeReview,
} from '@/test/ai'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import RecommendationsPanel from '@/views/ai/RecommendationsPanel.vue'
import ReviewDialog from '@/views/ai/ReviewDialog.vue'

const coffee = makeRecommendation()
const target = makeRecommendation({
  id: 'recommendation-target',
  payee: 'Target',
  confidence: 'medium',
  suggested_category_id: 'category-groceries',
})
const venmo = makeRecommendation({
  id: 'recommendation-venmo',
  payee: 'Venmo',
  confidence: 'high',
  suggested_category_id: 'category-transfers',
})

interface Options {
  settings?: ReturnType<typeof makeAiSettings>
  page?: api.RecommendationPage
  reviews?: api.AiReview[]
  route?: string
  /** What fails the first time each is asked for. */
  listFails?: boolean
  reviewsFail?: boolean
}

async function render({
  settings = makeAiSettings(),
  page = makeRecommendationPage([coffee, target, venmo], {
    counts: { open: 3, applied: 2, dismissed: 1 },
  }),
  reviews = [makeReview()],
  route,
  listFails = false,
  reviewsFail = false,
}: Options = {}) {
  const fetchList = vi.spyOn(api, 'fetchRecommendations').mockResolvedValue(page)
  const fetchReviews = vi.spyOn(api, 'fetchAiReviews').mockResolvedValue(reviews)
  if (listFails) fetchList.mockRejectedValueOnce(new Error('Offline'))
  if (reviewsFail) fetchReviews.mockRejectedValueOnce(new Error('Reviews offline'))
  const mounted = await mountWithPlugins(RecommendationsPanel, {
    route,
    beforeMount: () => {
      seedFinance()
      const ai = useAiStore()
      ai.providers = makeProviders()
      ai.settings = settings
    },
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find, fetchList, fetchReviews }
}

describe('RecommendationsPanel', () => {
  beforeEach(() => {
    notices.value = []
  })

  it('sums up what the AI suggested, lists what is waiting and says when it looked', async () => {
    const { wrapper, find, fetchList } = await render()

    expect(fetchList).toHaveBeenCalledWith({ status: 'open', page: 1, page_size: 20 })
    expect(find('tile-open').text()).toContain('3')
    expect(find('tile-open').text()).toContain('Waiting for you')
    expect(find('tile-applied').text()).toContain('2')
    expect(find('tile-dismissed').text()).toContain('1')
    expect(wrapper.findAll('[data-test="recommendation"]')).toHaveLength(3)
    expect(find('recommendation-status').text()).toContain('Waiting (3)')
    expect(find('recommendation-status').text()).toContain('Applied (2)')
    expect(find('recommendation-status').text()).toContain('Dismissed (1)')
    expect(wrapper.text()).toContain('Nothing changes until you apply a suggestion.')
    expect(find('review-history').exists()).toBe(true)
    expect(useAiStore().counts).toEqual({ open: 3, applied: 2, dismissed: 1 })
  })

  it('shows a skeleton while it loads', async () => {
    vi.spyOn(api, 'fetchRecommendations').mockReturnValue(new Promise(() => undefined))
    vi.spyOn(api, 'fetchAiReviews').mockResolvedValue([])
    const { wrapper } = await mountWithPlugins(RecommendationsPanel, {
      beforeMount: () => {
        seedFinance()
        useAiStore().settings = makeAiSettings()
      },
    })

    expect(wrapper.find('[data-test="recommendations-loading"]').exists()).toBe(true)
  })

  it('applies the ticked suggestions', async () => {
    const apply = vi
      .spyOn(api, 'applyRecommendations')
      .mockResolvedValue({ changed: 2, skipped: 0 })
    const { wrapper, find, fetchList } = await render()
    const boxes = wrapper.findAll('[data-test="recommendation-select"] input')
    await boxes[0]!.setValue(true)
    await boxes[2]!.setValue(true)
    expect(find('apply-selected').text()).toBe('Apply 2')

    await find('apply-selected').trigger('click')
    await flushPromises()

    expect(apply).toHaveBeenCalledWith(['recommendation-coffee', 'recommendation-venmo'])
    expect(notices.value.map((notice) => notice.text)).toEqual(['Applied 2 suggestions.'])
    expect(fetchList).toHaveBeenCalledTimes(2)
    expect(find('apply-selected').exists()).toBe(false)
  })

  it('dismisses the ticked suggestions', async () => {
    const dismiss = vi
      .spyOn(api, 'dismissRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const { wrapper, find } = await render()
    await wrapper.findAll('[data-test="recommendation-select"] input')[1]!.setValue(true)

    await find('dismiss-selected').trigger('click')
    await flushPromises()

    expect(dismiss).toHaveBeenCalledWith(['recommendation-target'])
    expect(notices.value.map((notice) => notice.text)).toEqual(['Dismissed 1 suggestion.'])
  })

  it('applies or dismisses one from its own buttons', async () => {
    const apply = vi
      .spyOn(api, 'applyRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const dismiss = vi
      .spyOn(api, 'dismissRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const { wrapper } = await render()
    const row = (index: number) => wrapper.findAll('[data-test="recommendation"]')[index]!

    await row(0).find('[data-test="reco-apply"]').trigger('click')
    await flushPromises()
    await row(1).find('[data-test="reco-dismiss"]').trigger('click')
    await flushPromises()

    expect(apply).toHaveBeenCalledWith(['recommendation-coffee'])
    expect(dismiss).toHaveBeenCalledWith(['recommendation-target'])
  })

  it('asks for a review from the header, and closes the dialog again', async () => {
    const { wrapper, find } = await render()
    const dialog = () => wrapper.findComponent(ReviewDialog)

    await find('review-open').trigger('click')
    expect(dialog().props('modelValue')).toBe(true)

    dialog().vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(dialog().props('modelValue')).toBe(false)
  })

  it('ticks the high-confidence ones in one go', async () => {
    const { wrapper, find } = await render()

    await find('select-confident').trigger('click')

    const ticked = wrapper
      .findAll('[data-test="recommendation-select"] input')
      .map((box) => (box.element as HTMLInputElement).checked)
    expect(ticked).toEqual([true, false, true])
    expect(find('apply-selected').text()).toBe('Apply 2')
  })

  it('has nothing to tick when none is high-confidence', async () => {
    const { find } = await render({
      page: makeRecommendationPage([makeRecommendation({ confidence: 'low' })]),
    })

    expect(find('select-confident').attributes('disabled')).toBeDefined()
  })

  it('says what went wrong when a decision fails', async () => {
    vi.spyOn(api, 'applyRecommendations').mockRejectedValue(new Error('Offline'))
    const { find } = await render()

    await find('reco-apply').trigger('click')
    await flushPromises()

    expect(find('decide-error').text()).toBe('Offline')
  })

  it('shows the applied or the dismissed, from the first page', async () => {
    const { wrapper, find, fetchList } = await render()

    await find('recommendation-status').findAll('button')[1]!.trigger('click')
    await flushPromises()

    expect(fetchList).toHaveBeenLastCalledWith({ status: 'applied', page: 1, page_size: 20 })
    expect(wrapper.find('[data-test="select-confident"]').exists()).toBe(false)
  })

  it('shows one review’s suggestions, and goes back to all of them', async () => {
    const { wrapper, find, fetchList } = await render({
      reviews: [makeReview({ id: 'review-a', source: 'import', file_name: 'harbor.csv' })],
    })

    await find('review-show').trigger('click')
    await flushPromises()

    expect(fetchList).toHaveBeenLastCalledWith({
      status: 'open',
      review_id: 'review-a',
      page: 1,
      page_size: 20,
    })
    expect(find('review-filter').text()).toContain('One review: harbor.csv')

    // The review's button toggles it off, as the chip's close does.
    await find('review-show').trigger('click')
    await flushPromises()
    expect(find('review-filter').exists()).toBe(false)
    expect(fetchList).toHaveBeenLastCalledWith({ status: 'open', page: 1, page_size: 20 })

    await find('review-show').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="review-filter"] .v-chip__close').trigger('click')
    await flushPromises()
    expect(find('review-filter').exists()).toBe(false)
  })

  it('shows the waiting ones of a review that has none by looking at the applied', async () => {
    const { find, fetchList } = await render({
      reviews: [makeReview({ id: 'review-a', open: 0, applied: 2 })],
    })

    await find('review-show').trigger('click')
    await flushPromises()

    expect(fetchList).toHaveBeenLastCalledWith({
      status: 'open',
      review_id: 'review-a',
      page: 1,
      page_size: 20,
    })
  })

  it('opens at one review when a link names it, even if it isn’t in the latest', async () => {
    const { find, fetchList } = await render({ route: '/ai/recommendations?review=review-z' })

    expect(fetchList).toHaveBeenCalledWith({
      status: 'open',
      review_id: 'review-z',
      page: 1,
      page_size: 20,
    })
    expect(find('review-filter').text()).toBe('One review')
  })

  it('pages through a long list', async () => {
    const page = makeRecommendationPage([coffee], { total: 45, page_size: 20 })
    const { find, fetchList } = await render({ page })

    expect(find('recommendation-pages').exists()).toBe(true)
    await find('recommendation-pages').findAll('button')[2]!.trigger('click')
    await flushPromises()

    expect(fetchList).toHaveBeenLastCalledWith({ status: 'open', page: 2, page_size: 20 })
  })

  it('has no pages for a short list', async () => {
    const { find } = await render()

    expect(find('recommendation-pages').exists()).toBe(false)
  })

  describe('with nothing to show', () => {
    const empty = makeRecommendationPage([], { counts: { open: 0, applied: 0, dismissed: 0 } })

    it('says there is nothing yet, and offers a review', async () => {
      const { wrapper, find } = await render({ page: empty, reviews: [] })

      expect(find('recommendations-empty').text()).toContain('No suggestions yet')
      expect(find('review-history').exists()).toBe(false)
      await find('review-empty-open').trigger('click')
      expect(wrapper.findComponent(ReviewDialog).props('modelValue')).toBe(true)
    })

    it('says the AI agrees when it has looked', async () => {
      const { find } = await render({ page: empty })

      expect(find('recommendations-empty').text()).toContain('Nothing waiting')
      expect(find('recommendations-empty').text()).toContain('The AI agrees')
    })

    it.each([
      ['applied', 'Suggestions you apply are kept here.'],
      ['dismissed', 'Suggestions you dismiss are kept here.'],
    ])('says where the %s ones will be kept', async (status, text) => {
      const { find } = await render({ page: empty })

      await find('recommendation-status')
        .findAll('button')
        [status === 'applied' ? 1 : 2]!.trigger('click')
      await flushPromises()

      expect(find('recommendations-empty').text()).toContain('Nothing here yet')
      expect(find('recommendations-empty').text()).toContain(text)
      expect(find('review-empty-open').exists()).toBe(false)
    })

    it('sends them to set AI up when it isn’t', async () => {
      const { find } = await render({ page: empty, reviews: [], settings: aiOff })

      expect(find('review-open').exists()).toBe(false)
      expect(find('review-empty-open').exists()).toBe(false)
      expect(find('recommendations-setup').attributes('href')).toBe('/settings/ai')
    })
  })

  it('says when the suggestions can’t be loaded, and tries again', async () => {
    const { find, fetchList } = await render({ listFails: true })

    expect(find('recommendations-error').text()).toContain("Couldn't load the suggestions. Offline")
    expect(find('recommendations-empty').exists()).toBe(false)

    await find('recommendations-retry').trigger('click')
    await flushPromises()

    expect(fetchList).toHaveBeenCalledTimes(2)
    expect(find('recommendations-error').exists()).toBe(false)
  })

  it('says when the reviews can’t be loaded', async () => {
    const { find } = await render({ reviewsFail: true })

    expect(find('recommendations-error').text()).toContain('Reviews offline')
  })

  // These wait on the clock, so they're given room on a busy computer.
  describe('while the AI works', { timeout: 20_000 }, () => {
    // A review that's still going is looked at again every moment; here, every few milliseconds.
    beforeEach(() => {
      polling.interval = 10
    })
    afterEach(() => {
      polling.interval = POLL_INTERVAL
    })

    it('follows a review that is still going, and says when it has finished', async () => {
      const running = makeReview({
        id: 'going',
        status: 'running',
        reviewed: 20,
        total: 40,
        open: 0,
        applied: 0,
      })
      const finished = makeReview({
        id: 'going',
        status: 'done',
        reviewed: 40,
        total: 40,
        open: 4,
        applied: 0,
      })
      // It stays as it is until the test says it has finished, however slowly the test goes.
      const fetchReview = vi.spyOn(api, 'fetchAiReview').mockResolvedValue(running)
      const { wrapper, find, fetchList } = await render({ reviews: [running] })

      expect(find('active-review').text()).toContain('Looking over your transactions')
      expect(find('active-review').text()).toContain('Reviewed 20 of 40 transactions…')
      expect(find('review-open').attributes('disabled')).toBeDefined()
      expect(notices.value).toEqual([])

      fetchReview.mockResolvedValue(finished)
      await vi.waitFor(() => {
        expect(notices.value.map((notice) => notice.text)).toEqual([
          'The AI has 4 suggestions for you to look at.',
        ])
      })
      await flushPromises()

      expect(fetchReview.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(fetchList.mock.calls.length).toBeGreaterThan(1)
      expect(wrapper.find('[data-test="active-review"]').exists()).toBe(false)
    })

    it('says it was an import that is being looked over', async () => {
      const running = makeReview({ id: 'going', source: 'import', status: 'running' })
      vi.spyOn(api, 'fetchAiReview').mockResolvedValue(running)
      const { find } = await render({ reviews: [running] })

      expect(find('active-review').text()).toContain('Looking over your import')
    })

    it('says when the AI agrees with how everything is sorted', async () => {
      const running = makeReview({ id: 'going', status: 'running' })
      vi.spyOn(api, 'fetchAiReview').mockResolvedValue(
        makeReview({ id: 'going', status: 'done', open: 0, applied: 0, dismissed: 0 }),
      )
      await render({ reviews: [running] })

      await vi.waitFor(() => {
        expect(notices.value.map((notice) => notice.text)).toEqual([
          'The AI agrees with how those transactions are sorted.',
        ])
      })
    })

    it('says why a review stopped', async () => {
      const running = makeReview({ id: 'going', status: 'running' })
      vi.spyOn(api, 'fetchAiReview').mockResolvedValue(
        makeReview({ id: 'going', status: 'failed', error: 'The provider didn’t accept the key.' }),
      )
      await render({ reviews: [running] })

      await vi.waitFor(() => {
        expect(notices.value.map((notice) => [notice.tone, notice.text])).toEqual([
          ['error', 'The review stopped early. The provider didn’t accept the key.'],
        ])
      })
    })

    it('says so when a review stopped with no reason given', async () => {
      const running = makeReview({ id: 'going', status: 'running' })
      vi.spyOn(api, 'fetchAiReview').mockResolvedValue(
        makeReview({ id: 'going', status: 'failed', error: null }),
      )
      await render({ reviews: [running] })

      await vi.waitFor(() => {
        expect(notices.value.map((notice) => notice.text)).toEqual(['The review stopped early.'])
      })
    })

    it('follows a review it has just started', async () => {
      const started = makeReview({ id: 'new', status: 'pending', reviewed: 0, open: 0, applied: 0 })
      const fetchReview = vi.spyOn(api, 'fetchAiReview').mockResolvedValue(started)
      const { wrapper, find } = await render({ reviews: [] })

      wrapper.findComponent(ReviewDialog).vm.$emit('started', started)
      await flushPromises()

      expect(fetchReview).toHaveBeenCalledWith('new')
      expect(find('active-review').text()).toContain('Getting ready to look over 12 transactions…')
      expect(find('review-history').exists()).toBe(true)
    })

    it('says when there was nothing to review', async () => {
      const nothing = makeReview({ status: 'done', total: 0, reviewed: 0 })
      const fetchReview = vi.spyOn(api, 'fetchAiReview')
      const { wrapper } = await render({ reviews: [] })

      wrapper.findComponent(ReviewDialog).vm.$emit('started', nothing)
      await flushPromises()

      expect(fetchReview).not.toHaveBeenCalled()
      expect(notices.value.map((notice) => [notice.tone, notice.text])).toEqual([
        [
          'info',
          'Nothing to review. Every transaction there either has a category someone chose, or has a suggestion waiting.',
        ],
      ])
    })
  })
})
