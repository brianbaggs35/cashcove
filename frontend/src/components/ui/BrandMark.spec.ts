import BrandMark from '@/components/ui/BrandMark.vue'
import { mountWithPlugins } from '@/test/mount'

describe('BrandMark', () => {
  it('links home with the logo and name', async () => {
    const { wrapper } = await mountWithPlugins(BrandMark)
    expect(wrapper.attributes('href')).toBe('/')
    expect(wrapper.text()).toBe('Cashcove')
    expect(wrapper.find('img').attributes('width')).toBe('38')
  })

  it('takes a size, subtitle and destination', async () => {
    const { wrapper } = await mountWithPlugins(BrandMark, {
      props: { size: 30, subtitle: 'Personal finance', to: '/sign-in' },
    })
    expect(wrapper.attributes('href')).toBe('/sign-in')
    expect(wrapper.text()).toContain('Personal finance')
    expect(wrapper.find('img').attributes('height')).toBe('30')
  })
})
