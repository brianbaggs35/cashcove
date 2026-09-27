import { findNavItem, navItems, type NavName } from '@/navigation'

describe('navigation', () => {
  it('lists the seven tabs in menu order', () => {
    expect(navItems.map((item) => item.title)).toEqual([
      'Accounts',
      'Budget',
      'Subscriptions',
      'Transactions',
      'Import',
      'Connect',
      'Settings',
    ])
  })

  it('gives every tab a path and summary', () => {
    for (const item of navItems) {
      expect(item.path).toBe(`/${item.name}`)
      expect(item.summary).not.toBe('')
    }
  })

  it('lists what is planned only for tabs still to come', () => {
    const planned = navItems.filter((item) => item.planned).map((item) => item.name)
    expect(planned).toEqual(['budget', 'subscriptions', 'import', 'connect'])
    for (const name of planned) expect(findNavItem(name).planned?.length).toBeGreaterThan(0)
  })

  it('finds a tab by name', () => {
    expect(findNavItem('budget').title).toBe('Budget')
  })

  it('throws for an unknown tab', () => {
    expect(() => findNavItem('nope' as NavName)).toThrow('Unknown nav item: nope')
  })
})
