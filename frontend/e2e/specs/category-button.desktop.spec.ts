import { expect, expectAccessible, signInFiles, test, type ApiClient } from '../support'

interface Saved {
  category_id: string | null
}

/** A transaction as the API has it, by the id the baseline gave it. */
const category = (api: ApiClient, id: string) => api.get<Saved>(`/transactions/${id}`)

test.describe('Choosing a category by pressing it', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin gives a transaction a category, and takes it away again', async ({
    baseline,
    transactionsPage,
    apiAs,
    page,
  }) => {
    const api = await apiAs('admin')
    const { venmo } = baseline.transactions
    expect(venmo.category_id).toBeNull()

    await transactionsPage.goto()
    const button = transactionsPage.categoryButton('Venmo')
    await expect(button).toHaveAccessibleName('Change the category of Venmo, now uncategorized')
    await expect(button).toContainText('Uncategorized')

    await transactionsPage.recategorize('Venmo', 'Groceries')

    await expect(page.getByTestId('notification')).toContainText('Moved Venmo to Groceries')
    await expect(button).toContainText('Groceries')
    await expect(button).toHaveAccessibleName('Change the category of Venmo, now Groceries')
    expect((await category(api, venmo.id)).category_id).toBe(baseline.categories.Groceries.id)
    // Pressing the category isn't pressing the row, which would have opened the details.
    await expect(transactionsPage.infoDialog).toBeHidden()
    await expect(transactionsPage.dialog).toBeHidden()

    await transactionsPage.recategorize('Venmo', 'Uncategorized')

    await expect(button).toContainText('Uncategorized')
    expect((await category(api, venmo.id)).category_id).toBeNull()
  })

  test('the list is searched, and keeps the category a transaction has', async ({
    baseline,
    transactionsPage,
    apiAs,
    page,
  }) => {
    const api = await apiAs('admin')
    const { groceries } = baseline.transactions
    await transactionsPage.goto()

    await transactionsPage.categoryButton('Whole Foods').click()
    const menu = transactionsPage.categoryMenu
    await expect(menu).toBeVisible()
    // What it has now is marked, and the search starts where it can be typed in.
    const search = menu.getByTestId('category-search').getByRole('textbox')
    await expect(search).toBeFocused()
    await expect(menu.locator('.v-list-item--active')).toHaveText('🛒Groceries')

    await search.fill('zzzz')
    await expect(menu.getByTestId('category-none-match')).toHaveText('No categories match')
    await search.fill('coffee')
    await expect(menu.locator('.v-list-item')).toHaveText(['☕Coffee'])

    // Choosing what it has already changes nothing, and says nothing.
    await search.fill('groceries')
    await menu.locator('.v-list-item--active').click()
    await expect(menu).toBeHidden()
    await expect(page.getByTestId('notification')).toHaveCount(0)
    expect((await category(api, groceries.id)).category_id).toBe(baseline.categories.Groceries.id)
  })

  test('works from the keyboard, and leaves focus on the button', async ({
    baseline,
    transactionsPage,
    apiAs,
    page,
  }) => {
    const api = await apiAs('admin')
    await transactionsPage.goto()
    const button = transactionsPage.categoryButton('Venmo')

    await button.focus()
    await page.keyboard.press('Enter')
    await expect(transactionsPage.categoryMenu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(transactionsPage.categoryMenu).toBeHidden()
    await expect(button).toBeFocused()

    // Typing goes to the search, and Tab to what it found.
    await button.press('Enter')
    await expect(
      transactionsPage.categoryMenu.getByTestId('category-search').getByRole('textbox'),
    ).toBeFocused()
    await page.keyboard.type('restaur')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(transactionsPage.categoryMenu).toBeHidden()
    await expect(button).toContainText('Restaurants')
    expect((await category(api, baseline.transactions.venmo.id)).category_id).toBe(
      baseline.categories.Restaurants.id,
    )
  })

  test('is accessible with its list open', async ({ transactionsPage, page }) => {
    await transactionsPage.goto()
    await transactionsPage.categoryButton('Venmo').click()
    await expect(transactionsPage.categoryMenu).toBeVisible()

    await expectAccessible(page)
  })
})

test.describe('Choosing a category as a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows the category without a way to change it', async ({ transactionsPage }) => {
    await transactionsPage.goto()

    await expect(transactionsPage.row('Whole Foods')).toBeVisible()
    await expect(transactionsPage.row('Whole Foods').getByTestId('category-chip')).toContainText(
      'Groceries',
    )
    await expect(transactionsPage.categoryButton('Whole Foods')).toHaveCount(0)
    await expect(transactionsPage.row('Venmo').getByTestId('category-button')).toHaveCount(0)
  })
})
