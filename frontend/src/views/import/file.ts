import { FileSpreadsheet, FileText, type LucideIcon } from '@lucide/vue'

import type { AccountType } from '@/api/accounts'
import { MAX_FILE_BYTES, type FileFormat, type ImportFile } from '@/api/imports'
import { accountType } from '@/components/finance/accountTypes'
import { negate } from '@/utils/money'

/** What the file picker offers: banks' exports, which some banks save as .txt. */
export const ACCEPTED_FILES = '.csv,.tsv,.txt,.ofx,.qfx,.qbo,.qif'
/** The formats named where files are chosen. */
export const FILE_FORMATS = ['CSV', 'OFX', 'QFX', 'QBO', 'QIF'] as const

const OFX_NAMES = new Map([
  ['qfx', 'QFX'],
  ['qbo', 'QBO'],
])

/** The file's format as its bank names it: QFX and QBO files are OFX inside. */
export function formatName(format: FileFormat, fileName: string): string {
  if (format !== 'ofx') return format.toUpperCase()
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  return OFX_NAMES.get(extension) ?? 'OFX'
}

export function formatIcon(format: FileFormat): LucideIcon {
  return format === 'csv' ? FileSpreadsheet : FileText
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // A data URL, as it was asked for.
      resolve(reader.result as string)
    }
    reader.onerror = () => {
      reject(new Error(`Couldn’t read ${file.name}. Choose it again.`))
    }
    reader.readAsDataURL(file)
  })
}

/** A chosen file, as the API takes it. Files that are empty, or too big to be a statement, aren't. */
export async function readStatement(file: File): Promise<ImportFile> {
  if (file.size === 0) throw new Error(`${file.name} is empty. Download it from your bank again.`)
  if (file.size > MAX_FILE_BYTES) {
    const limit = MAX_FILE_BYTES / 1024 / 1024
    throw new Error(
      `${file.name} is over ${limit} MB, which is too big for a statement. Download fewer months at a time.`,
    )
  }
  const url = await dataUrl(file)
  return {
    file_name: file.name.slice(0, 255) || 'statement',
    content: url.slice(url.indexOf(',') + 1),
  }
}

/** "1 transaction", or "1,204 transactions". */
export function transactionCount(count: number): string {
  return count === 1 ? '1 transaction' : `${count.toLocaleString('en-US')} transactions`
}

/** A balance the way the Accounts tab shows it: what's owed, for cards and loans. */
export function balanceShown(type: AccountType, amount: string): { amount: string; owed: boolean } {
  const owed = accountType(type).liability
  return { amount: owed ? negate(amount) : amount, owed }
}
