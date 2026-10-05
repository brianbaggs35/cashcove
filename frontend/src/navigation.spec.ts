import { findNavItem, navItems, type NavName } from '@/navigation'

describe('navigation', () => {
  it('lists the eleven tabs in menu order, the dashboard first', () => {
    expect(navItems.map((item) => item.title)).toEqual([
      'Dashboard',
      'Accounts',
      'Budget',
      'Subscriptions',
      'Bills',
      'Transactions',
      'Categories',
      'Automations',
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

  it('finds a tab by name', () => {
    expect(findNavItem('budget').title).toBe('Budget')
  })

  it('throws for an unknown tab', () => {
    expect(() => findNavItem('nope' as NavName)).toThrow('Unknown nav item: nope')
  })
})
