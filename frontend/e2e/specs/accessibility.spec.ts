import type { Page } from '@playwright/test'

import { bankDate, csvFile, expect, expectAccessible, simpleCsv, TABS, test } from '../support'

const SETTINGS = [
  'general',
  'categories',
  'users',
  'alerts',
  'sync',
  'account',
  'security',
  'appearance',
  'system',
]

/** Every page of the signed-in app. */
const PAGES = [
  ...Object.keys(TABS)
    .filter((tab) => tab !== 'settings')
    .map((tab) => `/${tab}`),
  ...SETTINGS.map((section) => `/settings/${section}`),
]

/** What pages that load data show once they have, so axe checks the finished page. */
const LOADED: Record<string, string> = {
  '/accounts': 'net-worth',
  '/transactions': 'transaction-totals',
  '/connect': 'connection-card',
  '/import': 'import-item',
  '/settings/categories': 'category-row',
}

/** An open dialog or menu. */
const OVERLAY = '.v-overlay--active'

async function closeOverlay(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.locator(OVERLAY)).toHaveCount(0)
}

/** Opens each dialog or menu in turn, checks it with axe, and closes it again. */
async function expectAccessibleOverlays(
  page: Page,
  overlays: Record<string, () => Promise<void>>,
): Promise<void> {
  for (const [name, open] of Object.entries(overlays)) {
    await test.step(name, async () => {
      await open()
      await expectAccessible(page, { include: OVERLAY })
      await closeOverlay(page)
    })
  }
}

async function expectLoaded(page: Page, path: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const loaded = LOADED[path]
  if (loaded) await expect(page.getByTestId(loaded).first()).toBeVisible()
}

test.describe('Accessibility', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      // The app follows the device's theme until someone picks one.
      test.use({ colorScheme })

      test('the sign-in page', async ({ signInPage, baseline }) => {
        await signInPage.goto()
        await signInPage.email.fill(baseline.users.admin.email)
        await signInPage.password.fill(baseline.users.admin.password)

        await expectAccessible(signInPage.page)
      })

      test('the invitation page', async ({ page, baseline }) => {
        await page.goto(baseline.invitations.pending.link)
        await expect(page.getByTestId('invite-email')).toBeVisible()

        await expectAccessible(page)
      })

      test('the first-run setup wizard', async ({ page, baseline }) => {
        await baseline.freshInstall()
        await page.goto('/welcome')
        await expect(page.getByTestId('welcome-start')).toBeVisible()

        await expectAccessible(page)
      })

      test('every page an admin sees', async ({ page, signInAs }) => {
        test.slow()
        await signInAs('admin')

        for (const path of PAGES) {
          await test.step(path, async () => {
            await page.goto(path)
            await expectLoaded(page, path)

            await expectAccessible(page)
          })
        }
      })

      test('the pages a viewer sees', async ({ page, signInAs }) => {
        await signInAs('viewer')

        for (const path of [
          '/accounts',
          '/transactions',
          '/connect',
          '/import',
          '/settings/general',
          '/settings/categories',
          '/settings/users',
        ]) {
          await test.step(path, async () => {
            await page.goto(path)
            await expect(page.getByTestId('read-only-notice')).toBeVisible()
            await expectLoaded(page, path)

            await expectAccessible(page)
          })
        }
      })

      test('the account menu and the invite dialog', async ({ page, signInAs, shell }) => {
        await signInAs('admin')
        await page.goto('/settings/users')

        await page.getByTestId('invite-open').click()
        await expectAccessible(page, { include: OVERLAY })
        await closeOverlay(page)

        await shell.accountMenu.click()
        await expectAccessible(page, { include: OVERLAY })
      })

      test('the account dialogs and menu', async ({ page, signInAs, accountsPage }) => {
        await signInAs('admin')
        await accountsPage.goto()

        await expectAccessibleOverlays(page, {
          'adding an account': () => accountsPage.addButton.click(),
          "an account's menu": () =>
            accountsPage.row('Everyday checking').getByTestId('account-actions').click(),
          'editing a linked account': () => accountsPage.act('Rewards Visa', 'edit'),
          'confirming a closing': () => accountsPage.act('Everyday checking', 'close'),
        })
      })

      test('the transaction dialogs', async ({ page, signInAs, transactionsPage }) => {
        await signInAs('admin')
        await transactionsPage.goto()

        await expectAccessibleOverlays(page, {
          'adding a transaction': () => transactionsPage.addButton.click(),
          'editing one': () => transactionsPage.open('Whole Foods'),
          'one from a bank': () => transactionsPage.open('Blue Bottle Coffee'),
          'the filters': () => transactionsPage.openFilters(),
        })
      })

      test('the transaction details dialog', async ({ page, signInAs, transactionsPage }) => {
        // Desktop admins open the edit form directly; only phones have this details dialog.
        test.skip(test.info().project.name !== 'mobile', 'Phones open transaction details first')
        await signInAs('admin')
        await transactionsPage.goto()

        await expectAccessibleOverlays(page, {
          'viewing transaction details': () => transactionsPage.openDetails('Whole Foods'),
        })
      })

      test('categorizing a selection', async ({ page, signInAs, transactionsPage }) => {
        // Phones list transactions without the table's checkboxes, so there's nothing to select.
        test.skip(test.info().project.name === 'mobile', 'Only computers select several at once')
        await signInAs('admin')
        await transactionsPage.goto()
        await transactionsPage.select('Venmo', 'Whole Foods')

        await expectAccessible(page)
        await transactionsPage.bulkBar.getByTestId('bulk-categorize').click()
        await expectAccessible(page, { include: OVERLAY })
      })

      test('the connect wizard, and each bank’s dialogs and menu', async ({
        page,
        signInAs,
        connectPage,
        plaid,
      }) => {
        await signInAs('admin')
        await connectPage.goto()

        await expectAccessibleOverlays(page, {
          'the connect wizard': () => connectPage.addButton.click(),
          'choosing a new bank’s accounts': async () => {
            await connectPage.startConnecting()
            await plaid.connect('platypus')
            await expect(connectPage.accountRows).toHaveCount(3)
          },
          "a bank's menu": () =>
            connectPage.card('Tartan Bank').getByTestId('connection-actions').click(),
          'choosing a connected bank’s accounts': () => connectPage.act('Tartan Bank', 'choose'),
          'the sync history': async () => {
            await connectPage.act('Tartan Bank', 'history')
            await expect(connectPage.history.getByTestId('sync-history-item').first()).toBeVisible()
          },
          'removing a bank': () => connectPage.act('Tartan Bank', 'remove'),
        })
      })

      test('the import dialog, and the saved formats’ dialogs and menu', async ({
        page,
        baseline,
        signInAs,
        importPage,
      }) => {
        await signInAs('admin')
        await importPage.goto()
        const statement = simpleCsv('harbor-checking.csv', [
          { days_ago: 1, description: 'NORTHWIND HEALTH PAYROLL PPD', amount: '1875.00' },
          { days_ago: 2, description: 'LA TAQUERIA', amount: '-23.80' },
        ])

        await expectAccessibleOverlays(page, {
          'matching a file’s columns': () =>
            importPage.chooseFile(
              csvFile(
                'credit-union.csv',
                ['Date', 'Description', 'Amount', 'Type'],
                [[bankDate(1), 'NORTHWIND HEALTH PAYROLL', '1875.00', 'CR']],
              ),
            ),
          'reviewing its rows': async () => {
            await importPage.chooseFile(statement)
            await importPage.continue()
            await importPage.chooseAccount('Everyday checking')
          },
          'a file that can’t be read': () =>
            importPage.chooseFile({
              name: 'statement.pdf',
              mimeType: 'application/pdf',
              buffer: Buffer.from('%PDF-1.7\n'),
            }),
          "a saved format's menu": () =>
            importPage
              .format(baseline.saved_formats.maple_card.name)
              .getByTestId('saved-format-actions')
              .click(),
          'renaming a saved format': async () => {
            await importPage
              .format(baseline.saved_formats.maple_card.name)
              .getByTestId('saved-format-actions')
              .click()
            await page.locator(OVERLAY).getByTestId('saved-format-rename').click()
          },
          'undoing an import': () =>
            importPage
              .importItem(baseline.imports.checking_history.file_name)
              .getByTestId('import-item-undo')
              .click(),
        })
      })

      test('the category dialogs', async ({ page, signInAs, categoriesPage }) => {
        await signInAs('admin')
        await categoriesPage.goto()

        await expectAccessibleOverlays(page, {
          'adding a group': () => categoriesPage.addGroupButton.click(),
          'adding a category': () => categoriesPage.addCategory('Food & drink'),
          'deleting a category transactions use': () =>
            categoriesPage.actOnCategory('Groceries', 'delete'),
        })
      })
    })
  }
})
