import { FileSpreadsheet, FileText } from '@lucide/vue'

import { MAX_FILE_BYTES } from '@/api/imports'
import {
  balanceShown,
  formatIcon,
  formatName,
  readStatement,
  transactionCount,
} from '@/views/import/file'

describe('statement files', () => {
  it('names formats the way banks do', () => {
    expect(formatName('csv', 'checking.csv')).toBe('CSV')
    expect(formatName('qif', 'checking.qif')).toBe('QIF')
    expect(formatName('ofx', 'checking.ofx')).toBe('OFX')
    expect(formatName('ofx', 'Checking.QFX')).toBe('QFX')
    expect(formatName('ofx', 'checking.qbo')).toBe('QBO')
    expect(formatName('ofx', 'statement')).toBe('OFX')
    expect(formatIcon('csv')).toBe(FileSpreadsheet)
    expect(formatIcon('ofx')).toBe(FileText)
  })

  it('reads a file for the API', async () => {
    const file = new File(['Date,Amount\n'], 'checking.csv', { type: 'text/csv' })
    expect(await readStatement(file)).toEqual({
      file_name: 'checking.csv',
      content: btoa('Date,Amount\n'),
    })
    const unnamed = await readStatement(new File(['x'], ''))
    expect(unnamed.file_name).toBe('statement')
    const long = await readStatement(new File(['x'], `${'a'.repeat(300)}.csv`))
    expect(long.file_name).toHaveLength(255)
  })

  it('turns down files that are empty or too big to be a statement', async () => {
    await expect(readStatement(new File([], 'empty.csv'))).rejects.toThrow(
      'empty.csv is empty. Download it from your bank again.',
    )
    const big = new File(['x'], 'years.csv')
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 })
    await expect(readStatement(big)).rejects.toThrow(
      'years.csv is over 5 MB, which is too big for a statement. Download fewer months at a time.',
    )
  })

  it('says when the browser could not read the file', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
    })
    await expect(readStatement(new File(['x'], 'locked.csv'))).rejects.toThrow(
      'Couldn’t read locked.csv. Choose it again.',
    )
  })

  it('counts transactions', () => {
    expect(transactionCount(1)).toBe('1 transaction')
    expect(transactionCount(0)).toBe('0 transactions')
    expect(transactionCount(1204)).toBe('1,204 transactions')
  })

  it('shows what is owed on cards and loans', () => {
    expect(balanceShown('checking', '-12.00')).toEqual({ amount: '-12.00', owed: false })
    expect(balanceShown('credit_card', '-612.40')).toEqual({ amount: '612.40', owed: true })
    expect(balanceShown('loan', '250.00')).toEqual({ amount: '-250.00', owed: true })
  })
})
