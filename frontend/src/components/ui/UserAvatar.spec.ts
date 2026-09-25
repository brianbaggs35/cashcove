import UserAvatar, { AVATAR_COLORS, MUTED_AVATAR_COLOR } from '@/components/ui/UserAvatar.vue'
import { contrast } from '@/test/contrast'
import { mountWithPlugins } from '@/test/mount'

async function initials(name: string) {
  const { wrapper } = await mountWithPlugins(UserAvatar, { props: { name } })
  return wrapper.find('.user-avatar__initials').text()
}

describe('UserAvatar', () => {
  it.each([
    ['Alex Morgan', 'AM'],
    ['alex', 'A'],
    ['  Sam   de la Cruz ', 'SC'],
    ['Émile Zola', 'ÉZ'],
    ['🌊 Wave', '🌊W'],
    ['', '?'],
    ['   ', '?'],
  ])('shows %j as %s', async (name, expected) => {
    expect(await initials(name)).toBe(expected)
  })

  it('gives each name its own steady colour, at the size asked for', async () => {
    const colorOf = async (name: string) => {
      const { wrapper } = await mountWithPlugins(UserAvatar, { props: { name, size: 56 } })
      const avatar = wrapper.find('.user-avatar')
      expect(avatar.attributes('style')).toContain('56px')
      return avatar.attributes('style')
    }
    expect(await colorOf('Alex Morgan')).toBe(await colorOf('Alex Morgan'))
    expect(await colorOf('Alex Morgan')).not.toBe(await colorOf('Sam Lee'))
  })

  it('greys out someone whose account is turned off', async () => {
    const styleOf = async (name: string, muted: boolean) => {
      const { wrapper } = await mountWithPlugins(UserAvatar, { props: { name, muted } })
      return wrapper.find('.user-avatar').attributes('style')
    }
    expect(await styleOf('Alex Morgan', true)).toBe(await styleOf('Sam Lee', true))
    expect(await styleOf('Alex Morgan', true)).not.toBe(await styleOf('Alex Morgan', false))
  })

  it.each([...AVATAR_COLORS, MUTED_AVATAR_COLOR])(
    'keeps white initials readable on %s',
    (color) => {
      expect(contrast('#ffffff', color)).toBeGreaterThanOrEqual(4.5)
    },
  )
})
