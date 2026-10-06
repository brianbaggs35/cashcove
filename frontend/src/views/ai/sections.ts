import { Gauge, ListChecks, MessageCircleQuestion, type LucideIcon } from '@lucide/vue'

export type AiSectionKey = 'ask' | 'recommendations' | 'usage'

export interface AiSection {
  key: AiSectionKey
  title: string
  icon: LucideIcon
  /** Where the page is: the first, which is where the tab opens, has no section after /ai. */
  to: string
}

export const aiSections: AiSection[] = [
  { key: 'ask', title: 'Ask', icon: MessageCircleQuestion, to: '/ai' },
  { key: 'recommendations', title: 'Recommendations', icon: ListChecks, to: '/ai/recommendations' },
  { key: 'usage', title: 'Usage', icon: Gauge, to: '/ai/usage' },
]

const first = aiSections[0] as AiSection

export function findAiSection(key: unknown): AiSection {
  return aiSections.find((section) => section.key === key) ?? first
}
