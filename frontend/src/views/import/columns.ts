import type {
  AmountColumns,
  BankHistory,
  ColumnField,
  CsvColumns,
  CsvLayout,
  DateOrder,
  DecimalMark,
  Delimiter,
  PreviewRow,
} from '@/api/imports'

export interface ColumnFieldInfo {
  value: ColumnField
  title: string
  /** What it's for, where that isn't obvious. */
  subtitle?: string
}

/** What a CSV file's columns can hold, in the order they're offered. */
export const columnFields: ColumnFieldInfo[] = [
  { value: 'date', title: 'Date' },
  { value: 'payee', title: 'Payee or description' },
  { value: 'amount', title: 'Amount', subtitle: 'One column for money in and out' },
  { value: 'money_in', title: 'Money in', subtitle: 'Deposits and credits' },
  { value: 'money_out', title: 'Money out', subtitle: 'Withdrawals and debits' },
  { value: 'direction', title: 'In or out', subtitle: 'Says Debit or Credit, In or Out' },
  { value: 'memo', title: 'Memo or notes' },
  { value: 'category', title: 'Category', subtitle: 'The bank’s own categories' },
  { value: 'id', title: 'Transaction ID', subtitle: 'Keeps it from coming in twice' },
  { value: 'balance', title: 'Balance', subtitle: 'The balance after each one' },
]

export const dateOrders: { value: DateOrder; title: string }[] = [
  { value: 'mdy', title: 'Month first, like 09/26/2026' },
  { value: 'dmy', title: 'Day first, like 26/09/2026' },
  { value: 'ymd', title: 'Year first, like 2026-09-26' },
]

export const decimalMarks: { value: DecimalMark; title: string }[] = [
  { value: '.', title: 'Like 1,234.56' },
  { value: ',', title: 'Like 1.234,56' },
]

export const delimiters: { value: Delimiter; title: string }[] = [
  { value: ',', title: 'Commas' },
  { value: ';', title: 'Semicolons' },
  { value: '\t', title: 'Tabs' },
  { value: '|', title: 'Vertical bars' },
]

const FIELDS = columnFields.map((field) => field.value)

/** Amounts come in one column, in two, or in one beside a column saying which way they went. */
const CLASHES: Partial<Record<ColumnField, ColumnField[]>> = {
  amount: ['money_in', 'money_out'],
  direction: ['money_in', 'money_out'],
  money_in: ['amount', 'direction'],
  money_out: ['amount', 'direction'],
}

/** What column `index` holds, if anything. */
export function fieldOf(columns: CsvColumns, index: number): ColumnField | null {
  return FIELDS.find((field) => columns[field] === index) ?? null
}

export function amountStyle(columns: CsvColumns): AmountColumns {
  if (columns.money_in !== null || columns.money_out !== null) return 'split'
  return columns.direction === null ? 'one' : 'direction'
}

/**
 * The layout with column `index` holding `field`, or nothing. The field moves there from any
 * other column, and a way of giving amounts replaces the other ways.
 */
export function assignColumn(
  layout: CsvLayout,
  index: number,
  field: ColumnField | null,
): CsvLayout {
  const columns = { ...layout.columns }
  const current = fieldOf(columns, index)
  if (current) columns[current] = null
  if (field) {
    for (const other of CLASHES[field] ?? []) columns[other] = null
    columns[field] = index
  }
  const amounts = amountStyle(columns)
  const sameDirection = amounts === 'direction' && columns.direction === layout.columns.direction
  return {
    ...layout,
    columns,
    amounts,
    money_in_values: sameDirection ? layout.money_in_values : [],
  }
}

/** Whether the row's day is one the bank's own transactions cover, so it's likely a repeat. */
export function coveredByBank(row: PreviewRow, history: BankHistory | null): boolean {
  if (!history || !row.date) return false
  return row.date >= history.start && (history.end === null || row.date <= history.end)
}
