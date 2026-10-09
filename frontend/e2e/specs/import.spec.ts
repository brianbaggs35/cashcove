import {
  allTransactions,
  bankDate,
  csvFile,
  expect,
  ofxFile,
  signInFiles,
  simpleCsv,
  test,
  type BaselineAccount,
} from '../support'

/** An amount as the app shows it, e.g. `$4,301.38`. */
function dollars(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** What an account's balance comes to with `change` added, as the app shows it. */
const balancePlus = (account: BaselineAccount, change: number) =>
  dollars(Number(account.balance) + change)

test.describe('Importing statement files', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin matches a new export’s columns and imports what the account lacks', async ({
    baseline,
    importPage,
    transactionsPage,
  }) => {
    const { groceries, venmo } = baseline.transactions
    await importPage.goto()
    await importPage.chooseFile(
      csvFile(
        'harbor-checking-september.csv',
        ['Posting Date', 'Description', 'Debit', 'Credit'],
        [
          [bankDate(1), 'NORTHWIND HEALTH PAYROLL PPD', '', '1875.00'],
          [bankDate(venmo.days_ago), 'VENMO *CASHOUT', '40.00', ''],
          [bankDate(2), 'LA TAQUERIA', '23.80', ''],
          [bankDate(groceries.days_ago), 'Whole Foods', '84.12', ''],
          ['', 'PENDING - AMAZON MKTP US', '19.99', ''],
        ],
      ),
    )

    // Cashcove matches the columns by their names and what's in them.
    await expect(importPage.columnMatch('Posting Date')).toContainText('Date')
    await expect(importPage.columnMatch('Description')).toContainText('Payee or description')
    await expect(importPage.columnMatch('Debit')).toContainText('Money out')
    await expect(importPage.columnMatch('Credit')).toContainText('Money in')
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')

    // Named and categorized like the paychecks before it.
    await expect(importPage.row('NORTHWIND HEALTH PAYROLL PPD')).toContainText('Northwind Health')
    await expect(importPage.row('NORTHWIND HEALTH PAYROLL PPD')).toContainText('Paycheck')
    await expect(importPage.row('VENMO *CASHOUT')).toContainText('Possible duplicate: Venmo')
    await expect(importPage.row('Whole Foods')).toContainText('Possible duplicate: Whole Foods')
    await expect(importPage.row('PENDING - AMAZON MKTP US')).toContainText('It has no date.')
    await expect(importPage.dialog.getByTestId('import-submit')).toHaveText('Import 2 transactions')

    await importPage.chooseBalance('move')
    await expect(
      importPage.dialog.getByTestId('review-format-name').getByRole('textbox'),
    ).toHaveValue('Harbor Credit Union checking 2')
    await importPage.importRows()
    const note = importPage.dialog.getByTestId('import-done-note')
    await expect(note).toContainText(
      `Everyday checking’s balance is now ${balancePlus(baseline.accounts.checking, 1875 - 23.8)}.`,
    )
    await expect(note).toContainText('The file’s other 3 rows were left out.')
    await expect(note).toContainText('Saved the Harbor Credit Union checking 2 format')

    await importPage.seeTransactions()
    await expect(transactionsPage.chips).toContainText('From harbor-checking-september.csv')
    await expect(transactionsPage.rows).toHaveCount(2)
    await expect(transactionsPage.row('Northwind Health')).toContainText('1,875.00')
    await expect(transactionsPage.row('LA TAQUERIA')).toContainText('23.80')
  })

  test('the bank’s next file is read with its saved format', async ({
    accountsPage,
    baseline,
    importPage,
  }) => {
    const saved = baseline.saved_formats.harbor_checking
    await importPage.goto()
    await importPage.chooseFile(
      csvFile('harbor-checking-october.csv', saved.headers, [
        [bankDate(0), 'HARBOR CU ATM FEE', '-3.00', '2447.18', 'H9001'],
      ]),
    )

    await expect(importPage.dialog.getByTestId('review-saved-format')).toHaveText(
      `Read with your ${saved.name} format`,
    )
    await expect(importPage.dialog.getByTestId('review-account')).toContainText('Everyday checking')
    // The file says what the balance is after it.
    await expect(importPage.dialog.getByTestId('balance-suggested')).toBeVisible()
    await expect(importPage.dialog.getByTestId('balance-file').getByRole('radio')).toBeChecked()
    await importPage.importRows()
    await importPage.close()

    await expect(importPage.imports.first()).toContainText('harbor-checking-october.csv')
    await expect(importPage.format(saved.name).getByTestId('saved-format-used')).toContainText(
      'for Everyday checking',
    )
    await accountsPage.goto()
    await expect(accountsPage.balance('Everyday checking')).toHaveText('$2,447.18')
  })

  test('undoing an import deletes what it added', async ({
    page,
    baseline,
    importPage,
    transactionsPage,
  }) => {
    const history = baseline.imports.checking_history
    await importPage.goto()
    await expect(importPage.importItem(history.file_name)).toContainText(
      `${history.added} transactions`,
    )

    await importPage.importItem(history.file_name).getByTestId('import-item-undo').click()
    await expect(importPage.undoDialog).toContainText(
      `This deletes the ${history.added} transactions it added to Everyday checking.`,
    )
    await importPage.undoDialog.getByTestId('confirm-accept').click()
    await expect(importPage.importItem(history.file_name)).toHaveCount(0)
    await expect(page.getByText(`Deleted the ${history.added} transactions`)).toBeVisible()

    const kept = allTransactions(baseline).filter(
      (transaction) => transaction.account === 'checking' && transaction.file_import === null,
    )
    await transactionsPage.goto({ account: baseline.accounts.checking.id })
    await expect(transactionsPage.totals.getByTestId('totals-count')).toHaveText(
      String(kept.length),
    )
  })

  test('saved formats are renamed and deleted', async ({ baseline, importPage }) => {
    const { harbor_checking: harbor, maple_card: maple } = baseline.saved_formats
    await importPage.goto()
    await expect(importPage.format(maple.name).getByTestId('saved-format-used')).toHaveText(
      'Not used yet',
    )

    await importPage.renameFormat(maple.name, 'Maple card, before 2026')
    await expect(importPage.format('Maple card, before 2026')).toBeVisible()

    await importPage.deleteFormat(harbor.name)
    await expect(importPage.formats).toHaveCount(1)
    // What it read stays imported.
    await expect(importPage.importItem(baseline.imports.checking_history.file_name)).toBeVisible()
  })

  test('a saved format keeps a name of its own', async ({ page, baseline, importPage }) => {
    const { harbor_checking: harbor, maple_card: maple } = baseline.saved_formats
    await importPage.goto()
    await importPage.format(maple.name).getByTestId('saved-format-actions').click()
    await page.getByTestId('saved-format-rename').click()
    const dialog = page.getByRole('dialog', { name: 'Rename saved format' })
    await dialog
      .getByTestId('format-name-field')
      .getByRole('textbox')
      .fill(harbor.name.toLowerCase())
    await dialog.getByTestId('format-rename-save').click()

    await expect(dialog.getByTestId('format-name-field')).toContainText(
      `There's already a saved format called ${harbor.name.toLowerCase()}.`,
    )
  })

  test('a linked card’s older statements add to its history, and leave its balance to its bank', async ({
    accountsPage,
    baseline,
    importPage,
  }) => {
    const card = baseline.accounts.card
    const oldest = Math.max(
      ...allTransactions(baseline)
        .filter((transaction) => transaction.account === 'card')
        .map((transaction) => transaction.days_ago),
    )
    await importPage.goto()
    await importPage.chooseFile(
      ofxFile(
        'tartan-visa-2025.qfx',
        [
          { days_ago: oldest + 30, description: 'COSTCO WHSE #1102', amount: '-201.33', id: 'V1' },
          { days_ago: oldest + 10, description: 'SHELL OIL 57444', amount: '-52.10', id: 'V2' },
          { days_ago: oldest - 5, description: 'CHIPOTLE 2291', amount: '-18.75', id: 'V3' },
        ],
        {
          type: 'credit_card',
          number: `411111111111${card.mask}`,
          bank: card.institution,
          balance: '-1204.11',
        },
      ),
    )

    // Matched to the card by its last four digits.
    await expect(importPage.dialog.getByTestId('review-account')).toContainText(card.name)
    await expect(importPage.dialog.getByTestId('review-bank-history')).toContainText(
      'so the 1 row from then starts unticked',
    )
    await expect(importPage.dialog.getByTestId('review-bank-balance')).toContainText(
      `${dollars(-Number(card.balance))} owed`,
    )
    await expect(importPage.dialog.getByTestId('balance-choice')).toHaveCount(0)
    await importPage.importRows()
    await expect(importPage.dialog.getByTestId('import-done')).toContainText('2 transactions')
    await importPage.close()

    await accountsPage.goto()
    await expect(accountsPage.balance(card.name)).toContainText(dollars(-Number(card.balance)))
  })

  test('a file that isn’t a statement can be swapped for another', async ({ page, importPage }) => {
    await importPage.goto()
    await importPage.chooseFile({
      name: 'statement.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // A workbook is a zip file, which starts with these bytes.
      buffer: Buffer.from('PK\x03\x04workbook'),
    })
    await expect(importPage.notice).toContainText('This looks like an Excel workbook.')

    const chooser = page.waitForEvent('filechooser')
    await importPage.dialog.getByTestId('import-choose-again').click()
    await (
      await chooser
    ).setFiles(
      simpleCsv('harbor-checking.csv', [
        { days_ago: 2, description: 'LA TAQUERIA', amount: '-23.80' },
      ]),
    )
    await expect(importPage.dialog.getByTestId('import-columns')).toBeVisible()
  })
})

test.describe('Imports, for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeAll(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a viewer sees what’s been imported, with nothing to change', async ({
    page,
    baseline,
    importPage,
    transactionsPage,
  }) => {
    const savings = baseline.imports.savings_history
    await importPage.goto()
    await expect(page.getByTestId('read-only-notice')).toBeVisible()
    await expect(importPage.fileDrop).toHaveCount(0)
    await expect(importPage.imports).toHaveCount(Object.keys(baseline.imports).length)
    await expect(importPage.formats).toHaveCount(Object.keys(baseline.saved_formats).length)
    await expect(page.getByTestId('import-item-undo')).toHaveCount(0)
    await expect(page.getByTestId('saved-format-actions')).toHaveCount(0)

    await importPage.importItem(savings.file_name).getByTestId('import-item-transactions').click()
    await expect(transactionsPage.totals.getByTestId('totals-count')).toHaveText(
      String(savings.added),
    )
  })
})
