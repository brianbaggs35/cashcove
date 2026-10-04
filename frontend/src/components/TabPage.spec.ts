import TabPage from '@/components/TabPage.vue'
import { mountWithPlugins } from '@/test/mount'

describe('TabPage', () => {
  it('shows the tab’s header over its content, and passes actions through', async () => {
    const { wrapper } = await mountWithPlugins(TabPage, {
      props: { name: 'budget' },
      slots: { default: '<p class="custom">Budget table</p>', actions: '<button>New</button>' },
    })
    expect(wrapper.find('h1').text()).toBe('Budget')
    expect(wrapper.find('.custom').text()).toBe('Budget table')
    expect(wrapper.find('header button').text()).toBe('New')
    wrapper.unmount()
  })

  it('leaves the actions out when there are none', async () => {
    const { wrapper } = await mountWithPlugins(TabPage, {
      props: { name: 'automations' },
      slots: { default: '<p class="custom">Automations</p>' },
    })
    expect(wrapper.find('h1').text()).toBe('Automations')
    expect(wrapper.find('.page-header__actions').exists()).toBe(false)
    wrapper.unmount()
  })
})
