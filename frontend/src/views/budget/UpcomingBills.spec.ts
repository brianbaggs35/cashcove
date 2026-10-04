import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import UpcomingBills from '@/views/budget/UpcomingBills.vue'

const bills = [
  { subscription_id: 'gym', name: 'Gym', due_on: '2026-09-22', amount: '10.00' },
  { subscription_id: 'power', name: 'Power', due_on: '2026-09-25', amount: '130.50' },
  { subscription_id: 'gym', name: 'Gym', due_on: '2026-09-29', amount: '10.00' },
]

async function render(left: string) {
  const mounted = await mountWithPlugins(UpcomingBills, {
    width: 1280,
    props: { bills, left },
    beforeMount: () => seedFinance(),
  })
  return mounted.wrapper
}

describe('UpcomingBills', () => {
  it('lists the bills still to come, and what is left after paying them', async () => {
    const wrapper = await render('750.00')

    expect(wrapper.findAll('[data-test="upcoming-bill"]').map((bill) => bill.text())).toEqual([
      expect.stringMatching(/^Gym\s*Due Sep 22, 2026\s*\$10\.00$/),
      expect.stringMatching(/^Power\s*Due Sep 25, 2026\s*\$130\.50$/),
      expect.stringMatching(/^Gym\s*Due Sep 29, 2026\s*\$10\.00$/),
    ])
    expect(wrapper.find('[data-test="upcoming-after"]').text()).toBe('$599.50')
    expect(wrapper.find('[data-test="upcoming-after"]').classes()).not.toContain('text-error')
  })

  it('says when they come to more than is left', async () => {
    const wrapper = await render('100.00')

    expect(wrapper.find('[data-test="upcoming-after"]').text()).toBe('-$50.50')
    expect(wrapper.find('[data-test="upcoming-after"]').classes()).toContain('text-error')
  })
})
