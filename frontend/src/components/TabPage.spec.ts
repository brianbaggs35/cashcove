import TabPage from '@/components/TabPage.vue'
import { findNavItem } from '@/navigation'
import { mountWithPlugins } from '@/test/mount'

describe('TabPage', () => {
  it('shows the header and the planned features by default', async () => {
    const { wrapper } = await mountWithPlugins(TabPage, { props: { name: 'import' } })
    expect(wrapper.find('h1').text()).toBe('Import')
    expect(wrapper.text()).toContain('Coming soon')
    for (const feature of findNavItem('import').planned) expect(wrapper.text()).toContain(feature)
    wrapper.unmount()
  })

  it('replaces the preview with custom content and passes actions through', async () => {
    const { wrapper } = await mountWithPlugins(TabPage, {
      props: { name: 'budget' },
      slots: { default: '<p class="custom">Budget table</p>', actions: '<button>New</button>' },
    })
    expect(wrapper.find('.custom').text()).toBe('Budget table')
    expect(wrapper.text()).not.toContain('Coming soon')
    expect(wrapper.find('header button').text()).toBe('New')
    wrapper.unmount()
  })
})
