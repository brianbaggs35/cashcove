import {
  Bell,
  CircleUserRound,
  Palette,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from '@lucide/vue'

export type SettingsSectionKey =
  'general' | 'users' | 'alerts' | 'sync' | 'account' | 'security' | 'appearance' | 'system'

export interface SettingsSection {
  key: SettingsSectionKey
  title: string
  subtitle: string
  icon: LucideIcon
}

export interface SettingsGroup {
  title: string
  sections: SettingsSection[]
}

export const defaultSection: SettingsSection = {
  key: 'general',
  title: 'General',
  subtitle: 'Household, currency and calendar',
  icon: SlidersHorizontal,
}

/** The household's settings, then each person's own, then Cashcove itself. */
export const settingsGroups: SettingsGroup[] = [
  {
    title: 'Household',
    sections: [
      defaultSection,
      { key: 'users', title: 'Users', subtitle: 'People and roles', icon: Users },
      { key: 'alerts', title: 'Alerts', subtitle: 'What Cashcove warns you about', icon: Bell },
      {
        key: 'sync',
        title: 'Sync',
        subtitle: 'How often to fetch new transactions',
        icon: RefreshCw,
      },
    ],
  },
  {
    title: 'You',
    sections: [
      {
        key: 'account',
        title: 'Account',
        subtitle: 'Your name, email and password',
        icon: CircleUserRound,
      },
      {
        key: 'security',
        title: 'Security',
        subtitle: 'Passkeys, two-step verification and devices',
        icon: ShieldCheck,
      },
      { key: 'appearance', title: 'Appearance', subtitle: 'Theme and display', icon: Palette },
    ],
  },
  {
    title: 'Cashcove',
    sections: [{ key: 'system', title: 'System', subtitle: 'Status and version', icon: Server }],
  },
]

export const settingsSections: SettingsSection[] = settingsGroups.flatMap((group) => group.sections)

export function findSection(key: unknown): SettingsSection {
  return settingsSections.find((section) => section.key === key) ?? defaultSection
}
