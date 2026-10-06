import { makeReview } from '@/test/ai'
import { mountWithPlugins } from '@/test/mount'
import ReviewProgress from '@/views/ai/ReviewProgress.vue'

async function render(changes: Parameters<typeof makeReview>[0]) {
  const { wrapper } = await mountWithPlugins(ReviewProgress, {
    props: { review: makeReview(changes) },
  })
  return wrapper
}

describe('ReviewProgress', () => {
  it('says it is getting ready before it starts', async () => {
    const wrapper = await render({ status: 'pending', reviewed: 0, total: 40 })

    expect(wrapper.find('output').text()).toBe('Getting ready to look over 40 transactions…')
    expect(
      wrapper.find('.v-progress-linear--indeterminate, [aria-busy], [role="progressbar"]').exists(),
    ).toBe(true)
  })

  it('says how far it has got while it runs', async () => {
    const wrapper = await render({ status: 'running', reviewed: 40, total: 120 })

    expect(wrapper.find('output').text()).toBe('Reviewed 40 of 120 transactions…')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('33')
  })

  it('has no progress to show for a review of nothing', async () => {
    const wrapper = await render({ status: 'running', reviewed: 0, total: 0 })

    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('0')
  })

  it('says why it stopped, and how far it had got', async () => {
    const wrapper = await render({
      status: 'failed',
      error: 'The provider didn’t accept the key.',
      reviewed: 40,
      total: 120,
    })

    const alert = wrapper.find('[data-test="review-failed"]')
    expect(alert.text()).toContain('The review stopped early.')
    expect(alert.text()).toContain('The provider didn’t accept the key.')
    expect(alert.text()).toContain('It had looked at 40 of 120 first.')
    expect(wrapper.find('[data-test="review-progress"]').exists()).toBe(false)
  })

  it('doesn’t say how far it got when it hadn’t', async () => {
    const wrapper = await render({ status: 'failed', error: 'No.', reviewed: 0 })

    expect(wrapper.find('[data-test="review-failed"]').text()).not.toContain('It had looked at')
  })

  it('shows nothing once it has finished', async () => {
    const wrapper = await render({ status: 'done' })

    expect(wrapper.find('[data-test="review-progress"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="review-failed"]').exists()).toBe(false)
  })
})
