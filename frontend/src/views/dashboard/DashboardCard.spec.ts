import { Landmark } from '@lucide/vue'

import { mountWithPlugins } from '@/test/mount'
import DashboardCard from '@/views/dashboard/DashboardCard.vue'

describe('DashboardCard', () => {
  it('has a title, its content, and a link to see more', async () => {
    const { wrapper } = await mountWithPlugins(DashboardCard, {
      props: { title: 'Budgets', icon: Landmark, to: '/budget' },
      slots: { default: '<p data-test="inside">What is in it</p>' },
    })

    expect(wrapper.find('h2').text()).toBe('Budgets')
    expect(wrapper.find('[data-test="inside"]').text()).toBe('What is in it')
    const link = wrapper.find('[data-test="dashboard-card-link"]')
    expect(link.text()).toBe('View all')
    expect(link.attributes('href')).toBe('/budget')
  })

  it('can name where the link goes, or have none', async () => {
    const named = await mountWithPlugins(DashboardCard, {
      props: { title: 'Budgets', icon: Landmark, to: '/budget', linkLabel: 'Open budgets' },
    })
    expect(named.wrapper.find('[data-test="dashboard-card-link"]').text()).toBe('Open budgets')

    const plain = await mountWithPlugins(DashboardCard, {
      props: { title: 'Coming up', icon: Landmark },
    })
    expect(plain.wrapper.find('[data-test="dashboard-card-link"]').exists()).toBe(false)
  })
})
