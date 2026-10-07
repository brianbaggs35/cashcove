import type { Page } from '@playwright/test'

import {
  AI_KEYS,
  expect,
  holdAi,
  setUpAi,
  signInFiles,
  test,
  type BaselineData,
  type TransactionsPage,
} from '../support'

/** Today where the browser is, which "last month" is counted from: Chicago, as the config sets. */
function today(): Date {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
    .format(new Date())
    .split('-')
    .map(Number)
  return new Date(Date.UTC(year!, month! - 1, day))
}

const iso = (date: Date) => date.toISOString().slice(0, 10)

/** The first and the last day of last month. */
function lastMonth(): { start: string; end: string } {
  const now = today()
  return {
    start: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
    end: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))),
  }
}

/** The tab lists this many transactions, or says none match. */
async function expectToList(transactionsPage: TransactionsPage, total: number): Promise<void> {
  if (total) {
    await expect(transactionsPage.totals.getByTestId('totals-count')).toHaveText(String(total))
  } else {
    await expect(transactionsPage.noneMatch).toBeVisible()
  }
}

/** What the address says the tab is showing. */
const shown = (page: Page) => new URL(page.url()).searchParams

/** What the account's name and the bank's would give away. */
function secretsOf(baseline: BaselineData): RegExp[] {
  return Object.values(baseline.accounts).flatMap((account) => [
    new RegExp(account.name, 'i'),
    new RegExp(account.institution, 'i'),
    new RegExp(`(?<!\\d)${account.mask}(?!\\d)`),
  ])
}

test.describe('Finding transactions in plain words', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('is not there, and the tab is as it was, until AI is set up', async ({
      transactionsPage,
    }) => {
      await transactionsPage.goto()

      await expect(transactionsPage.rows.first()).toBeVisible()
      await expect(transactionsPage.aiButton).toHaveCount(0)
      await expect(transactionsPage.aiSearch).toHaveCount(0)
    })

    test('what is described becomes the tab’s own filters, to look at and change', async ({
      apiAs,
      baseline,
      page,
      transactionsPage,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      const groceries = baseline.categories.Groceries.id
      const month = lastMonth()
      await transactionsPage.goto()
      await expect(transactionsPage.aiButton).toHaveAccessibleName('Find with AI')

      await transactionsPage.findWithAi('groceries over $50 spent last month')

      await expect(transactionsPage.aiResult).toContainText(
        'Showing what matches “groceries over $50 spent last month”.',
      )
      // They are the tab's own filters, in the address like any others.
      const filters = shown(page)
      expect(filters.getAll('category')).toEqual([groceries])
      expect(filters.get('direction')).toBe('out')
      expect(filters.get('min')).toBe('50.00')
      expect(filters.get('from')).toBe(month.start)
      expect(filters.get('to')).toBe(month.end)
      await expect(page.getByTestId(`filter-chip-category-${groceries}`)).toContainText('Groceries')
      await expect(page.getByTestId('filter-chip-direction')).toHaveText('Money out')
      await expect(page.getByTestId('filter-chip-amount')).toContainText('At least $50.00')
      await expect(page.getByTestId('filter-chip-dates')).toBeVisible()

      // The list is what those filters find, as the API says.
      const found = await api.get<{ total: number }>(
        `/transactions?category_id=${groceries}&direction=out&min_amount=50.00&start=${month.start}&end=${month.end}`,
      )
      await expectToList(transactionsPage, found.total)

      // And changing one is a tap on its chip.
      await page.getByRole('button', { name: 'Remove At least $50.00' }).click()
      await expect(page.getByTestId('filter-chip-amount')).toHaveCount(0)
      expect(shown(page).get('min')).toBeNull()
      expect(shown(page).get('direction')).toBe('out')
    })

    test('replaces the filters that were on, and keeps the page’s own order unless one was asked for', async ({
      apiAs,
      baseline,
      page,
      transactionsPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await transactionsPage.goto({ direction: 'in', status: 'posted', sort: 'payee' })

      await transactionsPage.findWithAi('coffee')

      const filters = shown(page)
      expect(filters.getAll('category')).toEqual([baseline.categories.Coffee.id])
      expect(filters.get('direction')).toBeNull()
      expect(filters.get('status')).toBeNull()
      expect(filters.get('sort')).toBe('payee')
    })

    test('says what it couldn’t use rather than guessing, and takes what it could', async ({
      apiAs,
      page,
      transactionsPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await transactionsPage.goto()

      await transactionsPage.findWithAi('uncategorized hobbies for a birthday')

      await expect(transactionsPage.aiIgnored).toHaveText(
        'Couldn’t use: birthday, the category “Hobbies”.',
      )
      await expect(page.getByTestId('filter-chip-uncategorized')).toBeVisible()
      expect(shown(page).getAll('category')).toEqual(['none'])
    })

    test('changes nothing when there was no filter in what was typed', async ({
      apiAs,
      page,
      transactionsPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await transactionsPage.goto({ direction: 'in' })

      await transactionsPage.findWithAi('something blue')

      await expect(transactionsPage.aiNothing).toContainText('There was no filter in that.')
      expect(shown(page).get('direction')).toBe('in')
      await expect(page.getByTestId('filter-chip-direction')).toHaveText('Money in')
    })

    test('the biggest purchases come first when that is asked for', async ({
      apiAs,
      page,
      transactionsPage,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await transactionsPage.goto()
      const biggest = await api.get<{ items: { payee: string }[] }>(
        '/transactions?direction=out&sort=amount&page_size=1',
      )

      await transactionsPage.findWithAi('my biggest purchases')

      expect(shown(page).get('sort')).toBe('amount')
      expect(shown(page).get('direction')).toBe('out')
      await expect(transactionsPage.rows.first()).toContainText(biggest.items[0]!.payee)
    })

    test('the accounts it names are found here, and neither they nor their banks are sent to the AI', async ({
      apiAs,
      baseline,
      harness,
      page,
      transactionsPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await transactionsPage.goto()

      await transactionsPage.findWithAi(
        'groceries on my visa, ending 3333 at Tartan, from account 99887766554433',
      )

      const card = baseline.accounts.card
      expect(shown(page).getAll('account')).toEqual([card.id])
      await expect(page.getByTestId(`filter-chip-account-${card.id}`)).toHaveText(card.name)
      const sent = (await harness.aiRequests()).map((request) => request.body).join('\n')
      // It was asked about what is left: the groceries.
      expect(sent).toContain('groceries')
      for (const secret of secretsOf(baseline)) expect(sent).not.toMatch(secret)
      expect(sent).not.toContain('99887766554433')
      expect(sent).not.toContain(AI_KEYS.openai)
    })

    test('a question that only names accounts is not sent anywhere', async ({
      apiAs,
      baseline,
      harness,
      page,
      transactionsPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await transactionsPage.goto()

      await transactionsPage.findWithAi('Everyday checking')

      expect(shown(page).getAll('account')).toEqual([baseline.accounts.checking.id])
      expect(await harness.aiRequests()).toEqual([])
    })

    test('says it is working and can be stopped, and then ignores the answer', async ({
      apiAs,
      page,
      transactionsPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await transactionsPage.goto()
      const holding = await holdAi(page, 'search')

      await transactionsPage.aiButton.click()
      await transactionsPage.aiSearch
        .getByTestId('ai-search-input')
        .getByRole('textbox')
        .fill('coffee last month')
      await transactionsPage.aiSearch.getByTestId('ai-search-find').click()

      const working = transactionsPage.aiSearch.getByTestId('ai-search-working')
      await expect(working.getByTestId('ai-progress-stage')).toHaveText('Working out the filters…')
      await expect(working.getByTestId('ai-progress-privacy')).toContainText(
        'Only what you typed, with account details taken out, and your category names go to GPT-6 Luna.',
      )
      await working.getByTestId('ai-search-stop').click()
      await expect(working).toHaveCount(0)

      const answered = page.waitForResponse('**/api/ai/search')
      holding.release()
      await (await answered).finished()
      await expect(transactionsPage.aiResult).toHaveCount(0)
      expect(shown(page).getAll('category')).toEqual([])
    })

    test('says why it failed when the AI can’t be reached', async ({
      apiAs,
      page,
      transactionsPage,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await transactionsPage.goto()
      // The key stops being accepted, as it does when someone rotates it.
      await api.put('/ai/settings', {
        provider: 'openai',
        model: 'gpt-6-luna',
        base_url: null,
        api_key: 'not-the-key',
        review_imports: true,
      })

      await transactionsPage.findWithAi('coffee')

      await expect(transactionsPage.aiError).toContainText("The provider didn't accept the key")
      expect(shown(page).getAll('category')).toEqual([])
    })
  })

  test.describe('as a viewer', () => {
    test.use({ storageState: signInFiles.viewer })

    test('can find transactions in plain words too, since it only picks filters', async ({
      apiAs,
      baseline,
      page,
      transactionsPage,
    }) => {
      await setUpAi(await apiAs('admin'))
      await transactionsPage.goto()

      await transactionsPage.findWithAi('coffee')

      expect(shown(page).getAll('category')).toEqual([baseline.categories.Coffee.id])
      await expect(transactionsPage.aiResult).toBeVisible()
    })
  })
})
