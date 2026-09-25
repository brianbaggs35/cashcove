import { defaultSection, findSection, settingsSections } from '@/views/settings/sections'

describe('settings sections', () => {
  it('lists every section with General first', () => {
    expect(settingsSections.map((section) => section.key)).toEqual([
      'general',
      'users',
      'alerts',
      'sync',
      'security',
      'appearance',
      'system',
    ])
    expect(settingsSections[0]).toBe(defaultSection)
  })

  it('finds sections and falls back to General', () => {
    expect(findSection('sync').title).toBe('Sync')
    expect(findSection('nope')).toBe(defaultSection)
    expect(findSection(undefined)).toBe(defaultSection)
  })
})
