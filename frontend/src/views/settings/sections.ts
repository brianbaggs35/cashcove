import {
  Bell,
  Palette,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from '@lucide/vue'

export type SettingsSectionKey =
  'general' | 'users' | 'alerts' | 'sync' | 'security' | 'appearance' | 'system'

export interface SettingsSection {
  key: SettingsSectionKey
  title: string
  subtitle: string
  icon: LucideIcon
}

export const defaultSection: SettingsSection = {
  key: 'general',
  title: 'General',
  subtitle: 'Household, currency and calendar',
  icon: SlidersHorizontal,
}

export const settingsSections: SettingsSection[] = [
  defaultSection,
  { key: 'users', title: 'Users', subtitle: 'People and roles', icon: Users },
  { key: 'alerts', title: 'Alerts', subtitle: 'What Cashcove warns you about', icon: Bell },
  { key: 'sync', title: 'Sync', subtitle: 'How often to fetch new transactions', icon: RefreshCw },
  { key: 'security', title: 'Security', subtitle: 'Protection for your data', icon: ShieldCheck },
  { key: 'appearance', title: 'Appearance', subtitle: 'Theme and display', icon: Palette },
  { key: 'system', title: 'System', subtitle: 'Status and version', icon: Server },
]

export function findSection(key: unknown): SettingsSection {
  return settingsSections.find((section) => section.key === key) ?? defaultSection
}
