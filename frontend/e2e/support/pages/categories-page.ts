import { expect, type Locator, type Page } from '@playwright/test'

import type { BaselineCategoryGroup } from '../harness'
import { choose, openOverlays, startingWith } from './fields'

/**
 * The Categories tab: the category groups, each with its categories and how many
 * transactions use them, and the dialogs that add, change and delete them.
 */
export class CategoriesPage {
  /** Add a group, in the tab's header. Admins only. */
  readonly addGroupButton: Locator
  /** Narrows the groups to those with a name, or a category's name, that has this in it. */
  readonly search: Locator
  readonly groupDialog: Locator
  readonly categoryDialog: Locator
  readonly deleteCategoryDialog: Locator

  constructor(readonly page: Page) {
    this.addGroupButton = page.getByTestId('group-add')
    this.search = page.getByTestId('category-search').getByRole('textbox')
    this.groupDialog = page.getByRole('dialog').filter({ has: page.getByTestId('group-save') })
    this.categoryDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByTestId('category-save') })
    this.deleteCategoryDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByTestId('delete-category-confirm') })
  }

  async goto(): Promise<void> {
    await this.page.goto('/categories')
    await expect(this.page.getByTestId('categories-loading')).toHaveCount(0)
  }

  /** A group's card, by its name. */
  group(name: string): Locator {
    return this.page.getByRole('region', { name, exact: true })
  }

  /** A category's row, by its name. Its link says how many transactions use it. */
  category(name: string): Locator {
    return this.page.getByTestId('category-row').filter({
      has: this.page.getByRole('link', { name: startingWith(`${name}:`) }),
    })
  }

  async actOnGroup(name: string, action: 'edit' | 'delete'): Promise<void> {
    await this.group(name).getByTestId('category-group-actions').click()
    await openOverlays(this.page).getByTestId(`category-group-${action}`).click()
  }

  async actOnCategory(name: string, action: 'edit' | 'delete'): Promise<void> {
    await this.category(name).getByTestId('category-actions').click()
    await openOverlays(this.page).getByTestId(`category-${action}`).click()
  }

  /** Fills in the add or edit group dialog. */
  async fillGroup(fields: { name?: string; kind?: BaselineCategoryGroup['kind'] }): Promise<void> {
    if (fields.name !== undefined) {
      await this.groupDialog.getByTestId('group-name').getByRole('textbox').fill(fields.name)
    }
    if (fields.kind) {
      await this.groupDialog.getByTestId(`group-kind-${fields.kind}`).getByRole('radio').check()
    }
  }

  async saveGroup(): Promise<void> {
    await this.groupDialog.getByTestId('group-save').click()
    await expect(this.groupDialog).toBeHidden()
  }

  /** Opens the dialog that adds a category to a group. */
  async addCategory(group: string): Promise<void> {
    await this.group(group).getByTestId('category-add').click()
    await expect(this.categoryDialog).toBeVisible()
  }

  /** Fills in the add or edit category dialog. */
  async fillCategory(fields: { emoji?: string; name?: string; group?: string }): Promise<void> {
    const dialog = this.categoryDialog
    if (fields.emoji !== undefined) {
      await dialog.getByTestId('emoji-picker').click()
      const typed = this.page.getByTestId('emoji-custom').getByRole('textbox')
      await typed.fill(fields.emoji)
      await typed.press('Enter')
    }
    if (fields.name !== undefined) {
      await dialog.getByTestId('category-name').getByRole('textbox').fill(fields.name)
    }
    if (fields.group !== undefined) await choose(dialog.getByTestId('category-group'), fields.group)
  }

  async saveCategory(): Promise<void> {
    await this.categoryDialog.getByTestId('category-save').click()
    await expect(this.categoryDialog).toBeHidden()
  }

  /**
   * Deletes a category, moving its transactions to another one, or leaving them
   * uncategorized when `moveTo` is left out.
   */
  async deleteCategory(name: string, { moveTo }: { moveTo?: string } = {}): Promise<void> {
    await this.actOnCategory(name, 'delete')
    const dialog = this.deleteCategoryDialog
    await expect(dialog).toBeVisible()
    const keep = dialog.getByTestId('delete-category-keep')
    // Which choices show depends on whether any transactions use it.
    if (moveTo !== undefined) {
      await keep.getByRole('radio', { name: 'Move them to another category' }).check()
      await choose(dialog.getByTestId('delete-category-move-to'), moveTo)
    } else if (await keep.count()) {
      await keep.getByRole('radio', { name: 'Leave them uncategorized' }).check()
    }
    await dialog.getByTestId('delete-category-confirm').click()
    await expect(dialog).toBeHidden()
  }
}
