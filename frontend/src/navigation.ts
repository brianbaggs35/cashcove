import {
  ArrowLeftRight,
  FileUp,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Plug,
  ReceiptText,
  Repeat,
  Settings,
  Tags,
  WandSparkles,
  type LucideIcon,
} from '@lucide/vue'

export type NavName =
  | 'dashboard'
  | 'accounts'
  | 'budget'
  | 'subscriptions'
  | 'bills'
  | 'transactions'
  | 'categories'
  | 'automations'
  | 'import'
  | 'connect'
  | 'settings'

export interface NavItem {
  name: NavName
  title: string
  path: string
  icon: LucideIcon
  summary: string
}

// The single source for the nav menu, routes and each tab's header.
export const navItems: NavItem[] = [
  {
    name: 'dashboard',
    title: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    summary: 'How your money is doing this month, at a glance.',
  },
  {
    name: 'accounts',
    title: 'Accounts',
    path: '/accounts',
    icon: Landmark,
    summary: 'Every bank, card, loan and cash account in one place.',
  },
  {
    name: 'budget',
    title: 'Budget',
    path: '/budget',
    icon: PiggyBank,
    summary: 'Budgets for a week, a month or a year, and what counts toward each.',
  },
  {
    name: 'subscriptions',
    title: 'Subscriptions',
    path: '/subscriptions',
    icon: Repeat,
    summary: 'Keep track of every recurring charge before it surprises you.',
  },
  {
    name: 'bills',
    title: 'Bills',
    path: '/bills',
    icon: ReceiptText,
    summary: 'Electricity, phone and the rest: see what is due and link each payment.',
  },
  {
    name: 'transactions',
    title: 'Transactions',
    path: '/transactions',
    icon: ArrowLeftRight,
    summary: 'Search, filter and edit everything that moved money.',
  },
  {
    name: 'categories',
    title: 'Categories',
    path: '/categories',
    icon: Tags,
    summary: 'Group your transactions for budgets and reports.',
  },
  {
    name: 'automations',
    title: 'Automations',
    path: '/automations',
    icon: WandSparkles,
    summary: 'Sort matching transactions into categories, subscriptions and bills for you.',
  },
  {
    name: 'import',
    title: 'Import',
    path: '/import',
    icon: FileUp,
    summary: 'Bring in statement files from any bank, and years of history.',
  },
  {
    name: 'connect',
    title: 'Connect',
    path: '/connect',
    icon: Plug,
    summary: 'Link your banks securely with Plaid.',
  },
  {
    name: 'settings',
    title: 'Settings',
    path: '/settings',
    icon: Settings,
    summary: 'Your household, your account and Cashcove itself.',
  },
]

export function findNavItem(name: NavName): NavItem {
  const item = navItems.find((candidate) => candidate.name === name)
  if (!item) throw new Error(`Unknown nav item: ${name}`)
  return item
}
