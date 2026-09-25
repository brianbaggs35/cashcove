import PageHeader from '@/components/PageHeader.vue'
import { findNavItem } from '@/navigation'
import { mountWithPlugins } from '@/test/mount'

describe('PageHeader', () => {
  const item = findNavItem('accounts')

  it('shows the tab title and summary', async () => {
    const { wrapper } = await mountWithPlugins(PageHeader, { props: { item } })
    expect(wrapper.find('h1').text()).toBe('Accounts')
    expect(wrapper.text()).toContain(item.summary)
    expect(wrapper.find('.ga-2').exists()).toBe(false)
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
