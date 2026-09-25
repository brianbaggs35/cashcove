import QrCode from '@/components/ui/QrCode.vue'
import { mountWithPlugins } from '@/test/mount'

describe('QrCode', () => {
  it('draws the value as a QR code with a light margin', async () => {
    const { wrapper } = await mountWithPlugins(QrCode, {
      props: { value: 'otpauth://totp/Cashcove:alex@example.com?secret=ABC', label: 'Scan me' },
    })
    const svg = wrapper.find('svg')
    expect(svg.attributes('aria-label')).toBe('Scan me')
    expect(svg.attributes('width')).toBe('208')
    const [x, y, width] = svg.attributes('viewBox')!.split(' ').map(Number)
    expect([x, y]).toEqual([-4, -4])
    expect(width).toBeGreaterThan(21 + 8 - 1)
    expect(wrapper.find('path').attributes('d')).toMatch(/^M/)
  })

  it('has a default label and takes a size', async () => {
    const { wrapper } = await mountWithPlugins(QrCode, { props: { value: 'x', size: 120 } })
    expect(wrapper.attributes('aria-label')).toBe('QR code')
    expect(wrapper.attributes('height')).toBe('120')
  })
})
