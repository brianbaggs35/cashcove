import { bankDate, csvFile, expect, signInFiles, test } from '../support'

/**
 * Banks' CSV files that nothing recognizes by their column names are read with a saved format
 * that someone chooses: a file with no names for its columns, or one with a column added since the
 * format was saved. A format that doesn't fit the file is turned down, and a new one made instead.
 */
test.describe('Importing with saved formats', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a format saved while importing is there to choose for the bank’s next file', async ({
    importPage,
  }) => {
    await importPage.goto()
    // Coastal's files have no names for their columns: a date, an amount, a star, the check number
    // and what it was for. Nothing but a person can tell the next one is the same.
    await importPage.chooseFile(
      csvFile('coastal-checking-august.csv', null, [
        [bankDate(61), '-42.50', '*', '1043', 'COASTAL WATER UTILITY'],
        [bankDate(60), '1200.00', '*', '', 'ACME HARDWARE PAYROLL'],
      ]),
    )
    await importPage.matchColumn('Column 4', 'Memo or notes')
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await importPage.saveFormat('Coastal Credit Union checking')
    await importPage.importRows()
    await importPage.close()
    await expect(importPage.format('Coastal Credit Union checking')).toContainText(
      'Files without column names',
    )

    await importPage.chooseFile(
      csvFile('coastal-checking-september.csv', null, [
        [bankDate(31), '-18.20', '*', '1044', 'COASTAL PHARMACY'],
        [bankDate(30), '-60.00', '*', '', 'ACME HARDWARE #221'],
      ]),
    )
    // Not recognized: the columns are worked out from what is in them, as for any new file.
    await expect(importPage.formatChoice).toContainText('New format')
    await expect(importPage.columnMatch('Column 4')).toContainText('Not imported')

    await importPage.chooseFormat('Coastal Credit Union checking')

    await expect(importPage.formatProblem).toHaveCount(0)
    await expect(importPage.dialog.getByTestId('columns-saved-format')).toContainText(
      'Read with your saved format, Coastal Credit Union checking.',
    )
    // Read the way it was saved, with the check number kept as a note.
    await expect(importPage.columnMatch('Column 4')).toContainText('Memo or notes')
    await importPage.continue()
    await expect(importPage.dialog.getByTestId('review-saved-format')).toHaveText(
      'Read with your Coastal Credit Union checking format',
    )
    await expect(importPage.dialog.getByTestId('review-account')).toContainText('Everyday checking')
    await expect(importPage.row('COASTAL PHARMACY')).toBeVisible()
    await importPage.importRows()
    await importPage.close()

    await expect(importPage.imports.first()).toContainText('coastal-checking-september.csv')
    await expect(
      importPage.format('Coastal Credit Union checking').getByTestId('saved-format-used'),
    ).toContainText('for Everyday checking')
  })

  test('a saved format brings its account along, and reads a file without column names', async ({
    baseline,
    importPage,
  }) => {
    const savings = baseline.saved_formats.harbor_savings
    await importPage.goto()
    await importPage.chooseFile(
      csvFile('harbor-savings-august.csv', null, [
        [bankDate(8), '-25.00', '*', '2201', 'TRANSFER TO CHECKING'],
        [bankDate(9), '14.18', '*', '', 'DIVIDEND'],
      ]),
    )
    await expect(importPage.formatPicker).toBeVisible()
    await expect(importPage.formatChoice).toContainText('New format')
    await expect(importPage.columnMatch('Column 4')).toContainText('Not imported')

    await importPage.chooseFormat(savings.name)

    await expect(importPage.dialog.getByTestId('columns-saved-format')).toContainText(savings.name)
    await expect(importPage.columnMatch('Column 4')).toContainText('Memo or notes')
    await expect(importPage.columnMatch('Column 5')).toContainText('Payee or description')
    await importPage.continue()
    // The account it was saved for, which a file with no names for its columns never says.
    await expect(importPage.dialog.getByTestId('review-account')).toContainText('Rainy day fund')
    await importPage.importRows()
    await importPage.close()

    await expect(importPage.format(savings.name).getByTestId('saved-format-used')).toContainText(
      'for Rainy day fund',
    )
  })

  test('a saved format reads a file that has a column more than it was saved with', async ({
    baseline,
    importPage,
  }) => {
    const harbor = baseline.saved_formats.harbor_checking
    await importPage.goto()
    await importPage.chooseFile(
      csvFile(
        'harbor-checking-november.csv',
        [...harbor.headers, 'Note'],
        [[bankDate(1), 'HARBOR CU ATM FEE', '-3.00', '2447.18', 'H9002', 'monthly']],
      ),
    )
    // The names are no longer the saved ones, so the format isn't recognized by them.
    await expect(importPage.dialog.getByTestId('columns-detected')).toBeVisible()
    await expect(importPage.formatChoice).toContainText('New format')

    await importPage.chooseFormat(harbor.name)

    // Every column it reads is still named the same, so it fits.
    await expect(importPage.formatProblem).toHaveCount(0)
    await expect(importPage.formatChoice).toContainText(harbor.name)
    await expect(importPage.dialog.getByTestId('columns-saved-format')).toContainText(harbor.name)
    await importPage.continue()
    await expect(importPage.dialog.getByTestId('review-account')).toContainText('Everyday checking')
    await expect(importPage.row('HARBOR CU ATM FEE')).toContainText('-$3.00')
    await importPage.importRows()
  })

  test('a saved format that doesn’t fit the file is turned down, and a new format is made instead', async ({
    baseline,
    importPage,
  }) => {
    const harbor = baseline.saved_formats.harbor_checking
    await importPage.goto()
    await importPage.chooseFile(
      csvFile(
        'lakeside-checking.csv',
        ['Posting Date', 'Description', 'Debit', 'Credit'],
        [
          [bankDate(3), 'LAKESIDE HARDWARE', '31.20', ''],
          [bankDate(2), 'ACME HARDWARE PAYROLL', '', '1500.00'],
        ],
      ),
    )

    await importPage.chooseFormat(harbor.name)

    // Said where it was chosen, with the columns that are different.
    await expect(importPage.formatProblem).toContainText(
      `The ${harbor.name} format doesn't fit this file:`,
    )
    await expect(importPage.formatProblem).toContainText(
      'column 1 is “Date” in the format but “Posting Date” in this file',
    )
    await expect(importPage.formatProblem).toContainText(
      'The columns below are as Cashcove found them.',
    )
    // The file is read as it was, and the format wasn't used.
    await expect(importPage.formatChoice).toContainText('New format')
    await expect(importPage.columnMatch('Posting Date')).toContainText('Date')
    await expect(importPage.columnMatch('Debit')).toContainText('Money out')
    await expect(importPage.notice).toHaveCount(0)

    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await importPage.saveFormat('Lakeside Bank checking')
    await importPage.importRows()
    await expect(importPage.dialog.getByTestId('import-done-note')).toContainText(
      'Saved the Lakeside Bank checking format',
    )
    await importPage.close()

    await expect(importPage.formats).toHaveCount(Object.keys(baseline.saved_formats).length + 1)
    // The one that was turned down is as it was.
    await expect(importPage.format(harbor.name).getByTestId('saved-format-columns')).toContainText(
      harbor.headers.join(' · '),
    )
  })

  test('a file read with a saved format can be read as a new format instead', async ({
    baseline,
    importPage,
  }) => {
    const { harbor_checking: harbor, maple_card: maple } = baseline.saved_formats
    await importPage.goto()
    await importPage.chooseFile(
      csvFile('harbor-checking-december.csv', harbor.headers, [
        [bankDate(0), 'HARBOR CU ATM FEE', '-3.00', '2447.18', 'H9003'],
      ]),
    )
    // Recognized by its column names, so it goes straight to the rows. Back to the columns, the
    // format is the one to read it with.
    await expect(importPage.dialog.getByTestId('review-saved-format')).toBeVisible()
    await importPage.dialog.getByTestId('import-back').click()
    await expect(importPage.formatChoice).toContainText(harbor.name)

    // Another that can't read it is turned down, and the file stays read as it was.
    await importPage.chooseFormat(maple.name)
    await expect(importPage.formatProblem).toContainText(
      `The ${maple.name} format doesn't fit this file:`,
    )
    await expect(importPage.formatProblem).toContainText(
      `Still reading with your ${harbor.name} format.`,
    )
    await expect(importPage.formatChoice).toContainText(harbor.name)
    await expect(importPage.dialog.getByTestId('columns-saved-format')).toContainText(harbor.name)

    await importPage.createNewFormat()

    await expect(importPage.formatProblem).toHaveCount(0)
    await expect(importPage.formatChoice).toContainText('New format')
    await expect(importPage.dialog.getByTestId('columns-detected')).toBeVisible()
    await importPage.continue()
    // The account it was going into stays.
    await expect(importPage.dialog.getByTestId('review-account')).toContainText('Everyday checking')
    // It's a new format: it's named and saved, beside the one the file would have been read with.
    await expect(importPage.dialog.getByTestId('review-saved-format')).toHaveCount(0)
    await expect(
      importPage.dialog.getByTestId('review-format-name').getByRole('textbox'),
    ).toHaveValue('Harbor Credit Union checking 2')
    await importPage.importRows()
    await importPage.close()

    await expect(importPage.formats).toHaveCount(Object.keys(baseline.saved_formats).length + 1)
    await expect(importPage.format('Harbor Credit Union checking 2')).toBeVisible()
  })

  test('there is nothing to choose between until a format is saved', async ({
    baseline,
    importPage,
  }) => {
    await importPage.goto()
    for (const saved of Object.values(baseline.saved_formats)) {
      await importPage.deleteFormat(saved.name)
    }
    await expect(importPage.formats).toHaveCount(0)

    await importPage.chooseFile(
      csvFile(
        'harbor-checking-january.csv',
        ['Date', 'Description', 'Amount'],
        [[bankDate(1), 'LA TAQUERIA', '-23.80']],
      ),
    )

    await expect(importPage.dialog.getByTestId('import-columns')).toBeVisible()
    await expect(importPage.formatPicker).toHaveCount(0)
    await expect(importPage.dialog.getByTestId('columns-detected')).toBeVisible()
    await expect(importPage.dialog).not.toContainText('Choose a saved format')
  })
})
