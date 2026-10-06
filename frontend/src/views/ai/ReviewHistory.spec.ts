import { useAiStore } from '@/stores/ai'
import { makeProviders, makeReview } from '@/test/ai'
import { mountWithPlugins } from '@/test/mount'
import ReviewHistory from '@/views/ai/ReviewHistory.vue'

async function render(reviews = [makeReview()], selected: string | null = null) {
  const { wrapper } = await mountWithPlugins(ReviewHistory, {
    props: { reviews, selected },
    beforeMount: () => {
      useAiStore().providers = makeProviders()
    },
  })
  return wrapper
}

describe('ReviewHistory', () => {
  it('says what started each review, how it went and what it found', async () => {
    const wrapper = await render([
      makeReview({ id: 'one' }),
      makeReview({
        id: 'two',
        source: 'import',
        file_name: 'harbor.csv',
        total: 3,
        reviewed: 3,
        open: 0,
        applied: 0,
        dismissed: 0,
        created_by: null,
      }),
    ])
    const [manual, imported] = wrapper.findAll('[data-test="review-history-item"]')

    expect(manual!.find('[data-test="review-title"]').text()).toBe(
      'Transactions you chose to review',
    )
    expect(manual!.text()).toContain('GPT-6 Luna')
    expect(manual!.text()).toContain('Alex Rivera')
    expect(manual!.find('[data-test="review-summary"]').text()).toBe(
      'Looked at 12 transactions. 3 suggestions found: 2 waiting, 1 applied, 0 dismissed.',
    )
    expect(imported!.find('[data-test="review-title"]').text()).toBe('Import of harbor.csv')
    expect(imported!.find('[data-test="review-summary"]').text()).toBe(
      'Looked at 3 transactions. Nothing to suggest.',
    )
    expect(imported!.text()).not.toContain('Alex Rivera')
    expect(imported!.find('[data-test="review-show"]').exists()).toBe(false)
  })

  it('names a model it doesn’t know by what it is called', async () => {
    const wrapper = await render([makeReview({ provider: 'ollama_local', model: 'llama3.2:3b' })])

    expect(wrapper.find('[data-test="review-history-item"]').text()).toContain('llama3.2:3b')
  })

  it('names an import whose file is gone only as an import', async () => {
    const wrapper = await render([makeReview({ source: 'import', file_name: null })])

    expect(wrapper.find('[data-test="review-title"]').text()).toBe('Import')
  })

  it('says why one stopped, and one that is still going', async () => {
    const wrapper = await render([
      makeReview({ id: 'stopped', status: 'failed', error: 'No.', reviewed: 4, total: 12 }),
      makeReview({ id: 'stopped-quietly', status: 'failed', error: null, reviewed: 0, total: 12 }),
      makeReview({ id: 'going', status: 'running', open: 0, applied: 0, dismissed: 0 }),
    ])
    const [stopped, quiet, going] = wrapper.findAll('[data-test="review-history-item"]')

    expect(stopped!.find('[data-test="review-summary"]').text()).toBe(
      'Stopped after 4 transactions of 12: No.',
    )
    expect(stopped!.find('[data-test="review-status"]').text()).toBe('Stopped')
    expect(quiet!.find('[data-test="review-summary"]').text()).toBe(
      'Stopped after 0 transactions of 12',
    )
    expect(going!.find('[data-test="review-summary"]').text()).toBe('Reviewing…')
    expect(going!.find('[data-test="review-status"]').text()).toBe('Reviewing')
  })

  it('can show the suggestions of one review, which is marked when it is the one shown', async () => {
    const wrapper = await render([makeReview({ id: 'one' }), makeReview({ id: 'two' })], 'two')
    const [first, second] = wrapper.findAll('[data-test="review-show"]')

    expect(first!.text()).toBe('Show')
    expect(first!.attributes('aria-pressed')).toBe('false')
    expect(second!.text()).toBe('Showing')
    expect(second!.attributes('aria-pressed')).toBe('true')
    await first!.trigger('click')

    expect(wrapper.emitted('show')?.[0]?.[0]).toMatchObject({ id: 'one' })
  })

  it('doesn’t offer to show the suggestions of a review that is still going and has none yet', async () => {
    const wrapper = await render([
      makeReview({ status: 'running', open: 0, applied: 1, dismissed: 0 }),
    ])

    expect(wrapper.find('[data-test="review-show"]').attributes('disabled')).toBeDefined()
  })
})
