import {
  defaultSection,
  findSection,
  settingsGroups,
  settingsSections,
} from '@/views/settings/sections'

describe('settings sections', () => {
  it('groups the household, your own settings and Cashcove itself', () => {
    expect(
      settingsGroups.map((group) => [group.title, group.sections.map((section) => section.key)]),
    ).toEqual([
      ['Household', ['general', 'users', 'alerts', 'sync']],
      ['You', ['account', 'security', 'appearance']],
      ['Cashcove', ['system']],
    ])
  })

  it('lists every section in order with General first', () => {
    expect(settingsSections.map((section) => section.key)).toEqual([
      'general',
      'users',
      'alerts',
      'sync',
      'account',
      'security',
      'appearance',
      'system',
    ])
    expect(settingsSections[0]).toBe(defaultSection)
  })

  it('finds sections and falls back to General', () => {
    expect(findSection('sync').title).toBe('Sync')
    expect(findSection('account').title).toBe('Account')
    expect(findSection('nope')).toBe(defaultSection)
    expect(findSection(undefined)).toBe(defaultSection)
  })
})
