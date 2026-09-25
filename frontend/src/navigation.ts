import {
  ArrowLeftRight,
  FileUp,
  Landmark,
  PiggyBank,
  Plug,
  Repeat,
  Settings,
  type LucideIcon,
} from '@lucide/vue'

export type NavName =
  'accounts' | 'budget' | 'subscriptions' | 'transactions' | 'import' | 'connect' | 'settings'

export interface NavItem {
  name: NavName
  title: string
  path: string
  icon: LucideIcon
  summary: string
  planned: string[]
}

// The single source for the nav menu, routes and each tab's header.
export const navItems: NavItem[] = [
  {
    name: 'accounts',
    title: 'Accounts',
    path: '/accounts',
    icon: Landmark,
    summary: 'Every bank, card, loan and cash account in one place.',
    planned: [
      'Accounts imported from Plaid, kept in sync',
      'Manual accounts you create, edit and close yourself',
      'Balances, account types and institutions at a glance',
    ],
  },
  {
    name: 'budget',
    title: 'Budget',
    path: '/budget',
    icon: PiggyBank,
    summary: 'Plan your month and your year, then see how you are tracking.',
    planned: [
      'Monthly and yearly budgets by category',
      'Spent versus planned, updated from your transactions',
      'Roll over what is left to next month',
    ],
  },
  {
    name: 'subscriptions',
    title: 'Subscriptions',
    path: '/subscriptions',
    icon: Repeat,
    summary: 'Keep track of every recurring charge before it surprises you.',
    planned: [
      'Add, edit and cancel subscriptions',
      'Alerts before a payment is due',
      'Monthly and yearly cost totals',
    ],
  },
  {
    name: 'transactions',
    title: 'Transactions',
    path: '/transactions',
    icon: ArrowLeftRight,
    summary: 'Search, filter and edit everything that moved money.',
    planned: [
      'Paginated list with full search and filters',
      'Create, edit, split and delete transactions',
      'Imported from Plaid or files, or entered by hand',
    ],
  },
  {
    name: 'import',
    title: 'Import',
    path: '/import',
    icon: FileUp,
    summary: 'Bring in statements from any bank.',
    planned: [
      'CSV, OFX and QFX files',
      'Map each column once and save it as a profile per bank',
      'Preview and skip duplicates before anything is saved',
    ],
  },
  {
    name: 'connect',
    title: 'Connect',
    path: '/connect',
    icon: Plug,
    summary: 'Link your banks securely with Plaid.',
    planned: [
      'Connect institutions through Plaid Link',
      'Automatic transaction and balance sync',
      'Reconnect or remove a link at any time',
    ],
  },
  {
    name: 'settings',
    title: 'Settings',
    path: '/settings',
    icon: Settings,
    summary: 'Your household, your account and Cashcove itself.',
    planned: ['Users and roles', 'Alert preferences', 'Security and sessions'],
  },
]

export function findNavItem(name: NavName): NavItem {
  const item = navItems.find((candidate) => candidate.name === name)
  if (!item) throw new Error(`Unknown nav item: ${name}`)
  return item
}
