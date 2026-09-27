import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'

/** Income, spending, or money moving between the household's own accounts. */
export type CategoryKind = 'income' | 'expense' | 'transfer'

export interface Category {
  id: string
  group_id: string
  name: string
  emoji: string
  transaction_count: number
}

export interface CategoryGroup {
  id: string
  name: string
  kind: CategoryKind
  categories: Category[]
}

export interface SuggestedCategoriesAdded {
  added: number
  groups: CategoryGroup[]
}

export interface CategoryInput {
  group_id: string
  name: string
  emoji: string
}

export interface GroupInput {
  name: string
  kind: CategoryKind
}

/** Income first, then spending, then transfers; categories by name within each group. */
export const fetchCategories = () => apiGet<CategoryGroup[]>('/categories')
export const addSuggestedCategories = () =>
  apiPost<SuggestedCategoriesAdded>('/categories/suggested')

export const createGroup = (input: GroupInput) =>
  apiPost<CategoryGroup>('/categories/groups', input)
export const updateGroup = (id: string, changes: Partial<GroupInput>) =>
  apiPatch<CategoryGroup>(`/categories/groups/${id}`, changes)
/** Removes the group and its categories; their transactions become uncategorized. */
export const deleteGroup = (id: string) => apiDelete(`/categories/groups/${id}`)

export const createCategory = (input: CategoryInput) => apiPost<Category>('/categories', input)
export const updateCategory = (id: string, changes: Partial<CategoryInput>) =>
  apiPatch<Category>(`/categories/${id}`, changes)
/** Removes the category. Its transactions move to `moveTo`, or become uncategorized. */
export const deleteCategory = (id: string, moveTo: string | null = null) =>
  apiDelete(moveTo ? `/categories/${id}?move_to=${moveTo}` : `/categories/${id}`)
