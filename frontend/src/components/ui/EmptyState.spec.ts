import { Landmark } from '@lucide/vue'

import EmptyState from '@/components/ui/EmptyState.vue'
import { mountWithPlugins } from '@/test/mount'

describe('EmptyState', () => {
  it('says what is missing and offers what to do', async () => {
    const { wrapper } = await mountWithPlugins(EmptyState, {
      props: { icon: Landmark, title: 'No accounts yet', text: 'Add one to get started.' },
      slots: { default: '<button>Add account</button>' },
    })
    expect(wrapper.text()).toContain('No accounts yet')
    expect(wrapper.text()).toContain('Add one to get started.')
    expect(wrapper.find('button').text()).toBe('Add account')
    expect(wrapper.classes()).toContain('py-12')
  })

  it('can be compact, with just a title', async () => {
    const { wrapper } = await mountWithPlugins(EmptyState, {
      props: { icon: Landmark, title: 'Nothing here', compact: true },
    })
    expect(wrapper.classes()).toContain('py-8')
    expect(wrapper.find('.empty-state__icon--compact').exists()).toBe(true)
    expect(wrapper.findAll('p')).toHaveLength(1)
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
