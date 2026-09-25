import { aliases } from '@/plugins/icons'
import { buildVuetify } from '@/plugins/vuetify'

describe('vuetify plugin', () => {
  it('defines light and dark themes and follows the system by default', () => {
    const vuetify = buildVuetify()
    expect(vuetify.theme.themes.value.light!.dark).toBe(false)
    expect(vuetify.theme.themes.value.dark!.dark).toBe(true)
    expect(vuetify.theme.isSystem.value).toBe(true)
  })

  it('maps every Vuetify icon alias to a Lucide component', () => {
    for (const icon of Object.values(aliases)) {
      expect(icon).toBeTypeOf('function')
    }
  })
})
