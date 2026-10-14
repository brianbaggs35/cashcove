import PageHeader from '@/components/PageHeader.vue'
import { findNavItem } from '@/navigation'
import { mountWithPlugins } from '@/test/mount'

describe('PageHeader', () => {
  const item = findNavItem('accounts')

  it('shows the tab title and summary', async () => {
    const { wrapper } = await mountWithPlugins(PageHeader, { props: { item } })
    expect(wrapper.find('h1').text()).toBe('Accounts')
    expect(wrapper.text()).toContain(item.summary)
    expect(wrapper.find('.page-header__actions').exists()).toBe(false)
    expect(wrapper.find('.page-header__meta').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders what the page says about itself under the summary, when it has something', async () => {
    const { wrapper } = await mountWithPlugins(PageHeader, {
      props: { item },
      slots: { meta: '<span>Paused</span>' },
    })
    expect(wrapper.find('.page-header__meta').text()).toBe('Paused')
    wrapper.unmount()
  })

  it('renders header actions', async () => {
    const { wrapper } = await mountWithPlugins(PageHeader, {
      props: { item },
      slots: { actions: '<button>Add account</button>' },
    })
    expect(wrapper.find('button').text()).toBe('Add account')
    wrapper.unmount()
  })
})
