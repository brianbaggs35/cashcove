import { aiSections, findAiSection } from '@/views/ai/sections'

describe('AI sections', () => {
  it('lists the pages of the AI tab, the chat first', () => {
    expect(aiSections.map((section) => [section.key, section.title, section.to])).toEqual([
      ['ask', 'Ask', '/ai'],
      ['recommendations', 'Recommendations', '/ai/recommendations'],
      ['usage', 'Usage', '/ai/usage'],
    ])
  })

  it('finds a page and falls back to the chat', () => {
    expect(findAiSection('usage').title).toBe('Usage')
    expect(findAiSection('recommendations').title).toBe('Recommendations')
    expect(findAiSection('nope')).toBe(aiSections[0])
    expect(findAiSection(undefined)).toBe(aiSections[0])
  })
})
