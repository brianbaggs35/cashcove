import RoleChip from '@/components/ui/RoleChip.vue'
import { mountWithPlugins } from '@/test/mount'

describe('RoleChip', () => {
  it.each([
    ['admin', 'Admin', 'text-primary'],
    ['viewer', 'Viewer', 'text-secondary'],
  ])('shows the %s role', async (role, title, color) => {
    const { wrapper } = await mountWithPlugins(RoleChip, { props: { role } })
    const chip = wrapper.find(`[data-test="role-${role}"]`)
    expect(chip.text()).toBe(title)
    expect(chip.classes()).toContain(color)
    expect(chip.classes()).toContain('v-chip--size-small')
  })

  it('comes in other sizes', async () => {
    const { wrapper } = await mountWithPlugins(RoleChip, {
      props: { role: 'admin', size: 'x-small' },
    })
    expect(wrapper.classes()).toContain('v-chip--size-x-small')
  })
})
