import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import ComingUp from '@/views/dashboard/ComingUp.vue'
import type { DueItem } from '@/views/dashboard/summary'

const late: DueItem = {
  id: 'power',
  name: 'City Power',
  kind: 'bill',
  dueOn: '2026-09-18',
  amount: '96.40',
  days: -2,
}
const soon: DueItem = {
  id: 'stream',
  name: 'Streamflix',
  kind: 'subscription',
  dueOn: '2026-09-22',
  amount: '14.99',
  days: 2,
}

async function render(items: DueItem[]) {
  const { wrapper } = await mountWithPlugins(ComingUp, {
    width: 1280,
    props: { items },
    beforeMount: () => seedFinance(),
  })
  return wrapper
}

describe('ComingUp', () => {
  it('lists what is due with when and for how much', async () => {
    const wrapper = await render([late, soon])

    const rows = wrapper.findAll('[data-test="coming-up-item"]').map((row) => row.text())
    expect(rows).toEqual([
      'City PowerOverdue by 2 days · Sep 18, 2026$96.40',
      'StreamflixDue in 2 days · Sep 22, 2026$14.99',
    ])
  })

  it('shows what is overdue in red, and links each to its own tab', async () => {
    const wrapper = await render([late, soon])

    const [first, second] = wrapper.findAll('[data-test="coming-up-item"]')
    expect(first!.find('[data-test="coming-up-when"]').classes()).toContain('text-error')
    expect(second!.find('[data-test="coming-up-when"]').classes()).not.toContain('text-error')
    expect(first!.find('a').attributes('href')).toBe('/bills')
    expect(second!.find('a').attributes('href')).toBe('/subscriptions')
    const icons = wrapper
      .findAll('[data-test="coming-up-item"] svg')
      .map((icon) => icon.classes().find((name) => name.startsWith('lucide-')))
    expect(icons).toEqual(['lucide-receipt-text', 'lucide-repeat'])
  })

  it('lists the first few and says how many more there are', async () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      ...soon,
      id: `due-${index}`,
      name: `Due ${index}`,
    }))

    const wrapper = await render(many)

    expect(wrapper.findAll('[data-test="coming-up-item"]')).toHaveLength(5)
    expect(wrapper.find('[data-test="coming-up-more"]').text()).toBe('And 2 more soon.')
    const few = await render([soon])
    expect(few.find('[data-test="coming-up-more"]').exists()).toBe(false)
  })

  it('says when nothing is due', async () => {
    const wrapper = await render([])

    expect(wrapper.find('[data-test="empty-state"]').text()).toContain('Nothing due soon')
    expect(wrapper.find('[data-test="empty-state"]').text()).toContain('next 14 days')
  })
})
