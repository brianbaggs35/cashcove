import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, type LucideIcon } from '@lucide/vue'

import type { CategoryKind } from '@/api/categories'

export interface CategoryKindInfo {
  value: CategoryKind
  title: string
  /** What its categories are for, when choosing a group's kind. */
  text: string
  icon: LucideIcon
  /** Chips for its categories use this; spending, the usual, stays plain. */
  color: string | undefined
}

const KINDS: Record<CategoryKind, CategoryKindInfo> = {
  expense: {
    value: 'expense',
    title: 'Spending',
    text: 'Money going out, like groceries, rent or fuel.',
    icon: ArrowUpRight,
    color: undefined,
  },
  income: {
    value: 'income',
    title: 'Income',
    text: 'Money coming in, like pay, interest or refunds.',
    icon: ArrowDownLeft,
    color: 'success',
  },
  transfer: {
    value: 'transfer',
    title: 'Transfers',
    text: "Money moving between your own accounts, which isn't spending or income.",
    icon: ArrowLeftRight,
    color: 'info',
  },
}

/** Spending, income and transfers, in the order they're offered. */
export const categoryKinds: CategoryKindInfo[] = [KINDS.expense, KINDS.income, KINDS.transfer]

export const categoryKind = (kind: CategoryKind): CategoryKindInfo => KINDS[kind]
