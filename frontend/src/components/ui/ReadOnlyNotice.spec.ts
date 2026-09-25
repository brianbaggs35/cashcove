import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { mountWithPlugins } from '@/test/mount'

describe('ReadOnlyNotice', () => {
  it('explains why things cannot be changed', async () => {
    const { wrapper } = await mountWithPlugins(ReadOnlyNotice)
    expect(wrapper.text()).toBe('You can see these settings. Only an admin can change them.')
  })

  it('can say something more specific', async () => {
    const { wrapper } = await mountWithPlugins(ReadOnlyNotice, { props: { text: 'Look only.' } })
    expect(wrapper.text()).toBe('Look only.')
  })
})
