import { MAX_STATEMENT_BYTES, type StatementRow } from '@/api/ai'
import type { ImportFile } from '@/api/imports'
import { base64Of } from '@/views/import/file'

/** What a document of rows read off a PDF starts with, which the import knows it by. */
const DOCUMENT = 'cashcove-statement'

/** A PDF is read by the AI, where the other files are read by Cashcove. */
export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/** A chosen PDF, as the API takes it. A PDF that's empty, or too big to be a statement, isn't. */
export async function readPdf(file: File): Promise<ImportFile> {
  if (file.size === 0) throw new Error(`${file.name} is empty. Download it from your bank again.`)
  if (file.size > MAX_STATEMENT_BYTES) {
    const limit = MAX_STATEMENT_BYTES / 1024 / 1024
    throw new Error(
      `${file.name} is over ${limit} MB, which is too big for a statement. Download fewer months at a time.`,
    )
  }
  return { file_name: file.name.slice(0, 255) || 'statement', content: await base64Of(file) }
}

function toBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCodePoint(byte)
  return btoa(binary)
}

/**
 * The rows read off a statement, checked and corrected, as the file the import reads: the preview
 * and the import take them like any file's, so duplicates, automations and balances work as they
 * do for a CSV file.
 */
export function statementDocument(fileName: string, rows: readonly StatementRow[]): ImportFile {
  const document = {
    format: DOCUMENT,
    version: 1,
    rows: rows.map(({ date, payee, amount }) => ({ date, payee, amount })),
  }
  return { file_name: fileName, content: toBase64(JSON.stringify(document)) }
}
