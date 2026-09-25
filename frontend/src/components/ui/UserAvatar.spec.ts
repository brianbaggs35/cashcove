import UserAvatar from '@/components/ui/UserAvatar.vue'
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
})
