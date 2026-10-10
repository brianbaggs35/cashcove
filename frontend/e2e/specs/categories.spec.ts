import {
  choose,
  expect,
  expectAccessible,
  openOverlays,
  signInFiles,
  startingWith,
  test,
  type ApiClient,
} from '../support'

interface Category {
  id: string
  name: string
  group_id: string
  emoji: string
  transaction_count: number
}

interface CategoryGroup {
  id: string
  name: string
  kind: 'income' | 'expense' | 'transfer'
  categories: Category[]
}

async function categoriesOf(api: ApiClient): Promise<Category[]> {
  return (await api.get<CategoryGroup[]>('/categories')).flatMap((group) => group.categories)
}

async function groupsOf(api: ApiClient): Promise<CategoryGroup[]> {
  return api.get<CategoryGroup[]>('/categories')
}

test.describe('Categories', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('lists every group with its categories and how many transactions use each', async ({
    page,
    apiAs,
    categoriesPage,
  }) => {
    const api = await apiAs('admin')
    const groceries = (await categoriesOf(api)).find((category) => category.name === 'Groceries')!

    await categoriesPage.goto()

    await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible()
    await expect(categoriesPage.group('Food & drink')).toBeVisible()
    await expect(categoriesPage.group('Income')).toBeVisible()
    await expect(categoriesPage.category('Groceries')).toContainText(
      `${groceries.transaction_count.toLocaleString('en-US')} transactions`,
    )
    await expect(categoriesPage.category('Groceries').getByRole('link')).toHaveAttribute(
      'href',
      `/transactions?category=${groceries.id}`,
    )
    await expectAccessible(page)
  })

  test('adds, changes and deletes groups and categories', async ({ apiAs, categoriesPage }) => {
    const api = await apiAs('admin')
    await categoriesPage.goto()

    // A group, with a category in it.
    await categoriesPage.addGroupButton.click()
    await categoriesPage.fillGroup({ name: 'Hobbies', kind: 'expense' })
    await categoriesPage.saveGroup()
    await expect(categoriesPage.group('Hobbies')).toContainText('No categories in this group yet.')
    await categoriesPage.addCategory('Hobbies')
    await categoriesPage.fillCategory({ emoji: '🎨', name: 'Crafts' })
    await categoriesPage.saveCategory()
    await expect(categoriesPage.group('Hobbies').getByTestId('category-row')).toHaveCount(1)
    await expect(categoriesPage.category('Crafts')).toContainText('No transactions')
    const crafts = (await categoriesOf(api)).find((category) => category.name === 'Crafts')!
    expect(crafts.emoji).toBe('🎨')

    // Renamed and moved to another group.
    await categoriesPage.actOnCategory('Crafts', 'edit')
    await categoriesPage.fillCategory({ name: 'Art supplies', group: 'Shopping' })
    await categoriesPage.saveCategory()
    await expect(
      categoriesPage.group('Shopping').getByRole('link', { name: startingWith('Art supplies:') }),
    ).toBeVisible()
    await expect(categoriesPage.group('Hobbies')).toContainText('No categories in this group yet.')
    const moved = (await groupsOf(api)).find((group) => group.name === 'Shopping')!
    expect(moved.categories.map((category) => category.name)).toContain('Art supplies')

    // A group renamed, then removed along with what's left in it.
    await categoriesPage.actOnGroup('Hobbies', 'edit')
    await categoriesPage.fillGroup({ name: 'Pastimes' })
    await categoriesPage.saveGroup()
    await expect(categoriesPage.group('Pastimes')).toBeVisible()
    await categoriesPage.actOnGroup('Pastimes', 'delete')
    await categoriesPage.page.getByTestId('confirm-accept').click()
    await expect(categoriesPage.group('Pastimes')).toHaveCount(0)
    expect((await groupsOf(api)).map((group) => group.name)).not.toContain('Pastimes')

    await categoriesPage.deleteCategory('Art supplies')
    await expect(categoriesPage.category('Art supplies')).toHaveCount(0)
    expect((await categoriesOf(api)).map((category) => category.name)).not.toContain('Art supplies')
  })

  test('deleting a category can move its transactions to another one', async ({
    apiAs,
    categoriesPage,
  }) => {
    const api = await apiAs('admin')
    const before = await categoriesOf(api)
    const groceries = before.find((category) => category.name === 'Groceries')!
    const restaurants = before.find((category) => category.name === 'Restaurants')!
    expect(groceries.transaction_count).toBeGreaterThan(0)

    await categoriesPage.goto()
    await categoriesPage.deleteCategory('Groceries', { moveTo: 'Restaurants' })

    await expect(categoriesPage.category('Groceries')).toHaveCount(0)
    await expect(categoriesPage.category('Restaurants')).toContainText(
      `${(restaurants.transaction_count + groceries.transaction_count).toLocaleString('en-US')} transactions`,
    )
    const after = await categoriesOf(api)
    expect(after.map((category) => category.name)).not.toContain('Groceries')
    expect(after.find((category) => category.name === 'Restaurants')!.transaction_count).toBe(
      restaurants.transaction_count + groceries.transaction_count,
    )
  })

  test('narrows the groups to what is searched for', async ({ page, categoriesPage }) => {
    await categoriesPage.goto()

    await categoriesPage.search.fill('coffee')
    await expect(categoriesPage.group('Food & drink')).toBeVisible()
    await expect(categoriesPage.group('Housing')).toHaveCount(0)

    await categoriesPage.search.fill('no such category')
    await expect(page.getByTestId('categories-none-match')).toContainText('No matching categories')

    await categoriesPage.search.fill('')
    await expect(categoriesPage.group('Housing')).toBeVisible()
  })

  test('category pickers find options by their group name', async ({ categoriesPage }) => {
    await categoriesPage.goto()
    await categoriesPage.actOnCategory('Groceries', 'delete')

    const dialog = categoriesPage.deleteCategoryDialog
    await dialog
      .getByTestId('delete-category-keep')
      .getByRole('radio', { name: 'Move them to another category' })
      .check()
    const picker = dialog.getByTestId('delete-category-move-to')
    await choose(picker, 'Restaurants', { search: 'Food & drink' })
    await expect(picker).toContainText('Restaurants')

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })

  test('the old Settings address opens the tab, and Settings no longer lists categories', async ({
    page,
  }) => {
    await page.goto('/settings/categories')
    await expect(page).toHaveURL(/\/categories$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible()

    await page.goto('/settings/general')
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    await expect(
      page
        .locator('[data-test="settings-nav"], [data-test="settings-chips"]')
        .getByText('Categories'),
    ).toHaveCount(0)
  })

  test('the dialogs are named and can be cancelled', async ({ categoriesPage }) => {
    await categoriesPage.goto()

    await categoriesPage.addGroupButton.click()
    await expect(categoriesPage.groupDialog).toBeVisible()
    await categoriesPage.page.keyboard.press('Escape')
    await expect(openOverlays(categoriesPage.page)).toHaveCount(0)
    await expect(categoriesPage.groupDialog).toBeHidden()
  })
})

test.describe('Categories for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeAll(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows the categories without ways to change them', async ({ page, categoriesPage }) => {
    await categoriesPage.goto()

    await expect(page.getByTestId('read-only-notice')).toContainText(
      'Only an admin can change them',
    )
    await expect(categoriesPage.group('Food & drink')).toBeVisible()
    await expect(categoriesPage.addGroupButton).toHaveCount(0)
    await expect(page.getByTestId('category-actions')).toHaveCount(0)
    await expect(page.getByTestId('category-add')).toHaveCount(0)
    await expect(page.getByTestId('categories-suggest')).toHaveCount(0)
  })
})
