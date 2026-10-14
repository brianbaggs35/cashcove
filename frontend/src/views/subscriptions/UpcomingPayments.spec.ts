import { mountWithPlugins } from '@/test/mount'
import { addDays, todayIso } from '@/utils/dates'
import UpcomingPayments from '@/views/subscriptions/UpcomingPayments.vue'

const inDays = (days: number) => addDays(todayIso(), days)

async function render(props: Partial<InstanceType<typeof UpcomingPayments>['$props']> = {}) {
  const { wrapper } = await mountWithPlugins(UpcomingPayments, {
    props: {
      upcoming: [
        { due_on: inDays(5), amount: '15.49' },
        { due_on: inDays(35), amount: '15.49' },
      ],
      varies: false,
      paused: false,
      ...props,
    },
  })
  return wrapper
}

describe('UpcomingPayments', () => {
  it('lists the payments that come next, the first of them marked, with how long until each', async () => {
    const wrapper = await render()

    const rows = wrapper.findAll('[data-test="upcoming-payment"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.find('[data-test="upcoming-when"]').text()).toBe('Due in 5 days')
    expect(rows[1]!.find('[data-test="upcoming-when"]').text()).toBe('Due in 35 days')
    expect(rows[0]!.find('[data-test="upcoming-amount"]').text()).toBe('$15.49')
    expect(rows[0]!.text()).toContain('Next')
    expect(rows[1]!.text()).not.toContain('Next')
    // A fixed amount isn't an estimate, so nothing says it is.
    expect(wrapper.find('[data-test="upcoming-amount"]').text()).not.toContain('~')
    expect(wrapper.text()).not.toContain('about what recent payments came to')
    expect(wrapper.find('[data-test="upcoming-paused"]').exists()).toBe(false)
  })

  it('writes the day out in full, in the household’s way', async () => {
    const wrapper = await render({ upcoming: [{ due_on: '2026-10-20', amount: '15.49' }] })

    expect(wrapper.find('[data-test="upcoming-date"]').text()).toContain('Tue, Oct 20, 2026')
  })

  it('shows one that is already overdue in the error color, and the ones after it as due', async () => {
    const wrapper = await render({
      upcoming: [
        { due_on: inDays(-2), amount: '15.49' },
        { due_on: inDays(28), amount: '15.49' },
      ],
    })

    const [late, later] = wrapper.findAll('[data-test="upcoming-when"]')
    expect(late!.text()).toBe('Overdue by 2 days')
    expect(late!.classes()).toContain('text-error')
    expect(later!.classes()).not.toContain('text-error')
  })

  it('says each is about what recent payments came to, when the amount changes every time', async () => {
    const wrapper = await render({ varies: true })

    const amount = wrapper.find('[data-test="upcoming-amount"]')
    expect(amount.text()).toBe('~ $15.49')
    expect(amount.find('[aria-label="About"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('about what recent payments came to')
  })

  it('says nothing is matched to a paused one’s dates, and uses its account’s currency', async () => {
    const wrapper = await render({ paused: true, currency: 'CAD' })

    expect(wrapper.find('[data-test="upcoming-paused"]').text()).toContain('no reminder is sent')
    expect(wrapper.find('[data-test="upcoming-amount"]').text()).toBe('CA$15.49')
  })
})
