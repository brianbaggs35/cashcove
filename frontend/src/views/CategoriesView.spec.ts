import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/categories'
import { ApiError } from '@/api/client'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import { coffee, makeGroups, seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import CategoriesView from '@/views/CategoriesView.vue'

async function render(role: 'admin' | 'viewer' = 'admin', loaded = true) {
  const mounted = await mountWithPlugins(CategoriesView, {
    width: 1280,
    route: '/categories',
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      seedFinance().categories.loaded = loaded
    },
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  const component = (name: string) => mounted.wrapper.findComponent({ name })
  const cards = () => mounted.wrapper.findAllComponents({ name: 'CategoryGroupCard' })
  return { ...mounted, find, component, cards }
}

describe('CategoriesView', () => {
  it('shows the Categories header over every group with its categories, loaded afresh', async () => {
    const fetch = vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const { find, cards, wrapper } = await render()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wrapper.find('h1').text()).toBe('Categories')
    expect(cards().map((card) => card.props('group').name)).toEqual([
      'Income',
      'Food & drink',
      'Hobbies',
      'Transfers',
    ])
    expect(find('group-add').exists()).toBe(true)
    expect(find('categories-suggest').exists()).toBe(true)
    expect(find('read-only-notice').exists()).toBe(false)
  })

  it('adds and edits groups', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const { find, component, cards } = await render()
    const dialog = () => component('GroupDialog')

    await find('group-add').trigger('click')
    await flushPromises()
    expect(dialog().props()).toMatchObject({ modelValue: true, group: null })
    dialog().vm.$emit('update:modelValue', false)

    const food = makeGroups()[1]!
    cards()[1]!.vm.$emit('editGroup', food)
    await flushPromises()
    expect(dialog().props()).toMatchObject({ modelValue: true, group: food })
  })

  it.each([
    [1, 'Its 2 categories go too, and their transactions become uncategorized.'],
    [0, 'Its category goes too, and their transactions become uncategorized.'],
    [2, 'It has no categories.'],
  ])('deletes group %i once confirmed', async (index, text) => {
    const groups = makeGroups()
    const group = groups[index]!
    const fetch = vi.spyOn(api, 'fetchCategories').mockResolvedValue(groups)
    const remove = vi.spyOn(api, 'deleteGroup').mockResolvedValue(undefined)
    const { cards } = await render()

    cards()[index]!.vm.$emit('deleteGroup', group)
    await flushPromises()
    expect(confirmRequest.value).toMatchObject({
      title: `Delete ${group.name}?`,
      confirmText: 'Delete group',
      tone: 'error',
    })
    expect(confirmRequest.value?.text).toContain(text)
    await answer(true)

    expect(remove).toHaveBeenCalledWith(group.id)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(notices.value.at(-1)?.text).toBe(`Deleted ${group.name}`)
  })

  it('keeps a group when deleting it is cancelled', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const remove = vi.spyOn(api, 'deleteGroup')
    const { cards } = await render()
    cards()[0]!.vm.$emit('deleteGroup', makeGroups()[0])
    await flushPromises()
    await answer(false)
    expect(remove).not.toHaveBeenCalled()
  })

  it('adds, edits and deletes categories', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const { component, cards } = await render()
    const dialog = () => component('CategoryDialog')
    const food = makeGroups()[1]!

    cards()[1]!.vm.$emit('addCategory', food)
    await flushPromises()
    expect(dialog().props()).toMatchObject({ modelValue: true, category: null, groupId: food.id })
    dialog().vm.$emit('update:modelValue', false)

    cards()[1]!.vm.$emit('editCategory', coffee)
    await flushPromises()
    expect(dialog().props()).toMatchObject({ modelValue: true, category: coffee })

    expect(component('DeleteCategoryDialog').exists()).toBe(false)
    cards()[1]!.vm.$emit('deleteCategory', coffee)
    await flushPromises()
    expect(component('DeleteCategoryDialog').props()).toMatchObject({
      modelValue: true,
      category: coffee,
    })
    component('DeleteCategoryDialog').vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(component('DeleteCategoryDialog').props('modelValue')).toBe(false)
  })

  it('starts admins off with the suggested categories', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([])
    const suggest = vi
      .spyOn(api, 'addSuggestedCategories')
      .mockResolvedValue({ added: 37, groups: makeGroups() })
    const { find, cards } = await render()

    expect(find('empty-state').text()).toContain('No categories yet')
    expect(find('group-add').exists()).toBe(false)
    await find('categories-suggest-first').trigger('click')
    await flushPromises()

    expect(suggest).toHaveBeenCalled()
    expect(cards()).toHaveLength(4)
    expect(notices.value.at(-1)?.text).toBe('Added 37 suggested categories')
  })

  it('offers an empty group to start from scratch', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([])
    const { find, component } = await render()
    const add = find('empty-state')
      .findAll('button')
      .find((button) => button.text() === 'Add a group')!
    await add.trigger('click')
    await flushPromises()
    expect(component('GroupDialog').props('modelValue')).toBe(true)
  })

  it.each([
    [1, 'Added 1 suggested category'],
    [0, 'You already have every suggested category'],
  ])('adds back %i deleted suggested categories', async (added, message) => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    vi.spyOn(api, 'addSuggestedCategories').mockResolvedValue({ added, groups: makeGroups() })
    const { find } = await render()
    await find('categories-suggest').trigger('click')
    await flushPromises()
    expect(notices.value.at(-1)?.text).toBe(message)
  })

  it('says when adding the suggested categories failed', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    vi.spyOn(api, 'addSuggestedCategories').mockRejectedValue(
      new ApiError(0, "Can't reach Cashcove."),
    )
    const { find } = await render()
    await find('categories-suggest').trigger('click')
    await flushPromises()
    expect(find('categories-suggest-error').text()).toBe("Can't reach Cashcove.")
  })

  it('shows viewers the categories without ways to change them', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const { find, component } = await render('viewer')
    expect(find('read-only-notice').text()).toContain('Only an admin can change them.')
    expect(find('group-add').exists()).toBe(false)
    expect(find('categories-suggest').exists()).toBe(false)
    expect(component('GroupDialog').exists()).toBe(false)
    expect(component('CategoryDialog').exists()).toBe(false)
  })

  it('tells viewers when there are no categories yet', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue([])
    const { find } = await render('viewer')
    expect(find('empty-state').text()).toContain("An admin hasn't set up any categories yet.")
    expect(find('empty-state').find('button').exists()).toBe(false)
  })

  it('says when the categories could not load, and tries again', async () => {
    const fetch = vi
      .spyOn(api, 'fetchCategories')
      .mockRejectedValueOnce(new ApiError(0, "Can't reach Cashcove."))
      .mockResolvedValue(makeGroups())
    const { find, cards } = await render('admin', false)

    expect(find('categories-error').text()).toContain(
      "Couldn't load the categories. Can't reach Cashcove.",
    )
    await find('categories-retry').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(cards()).toHaveLength(4)
  })

  it('shows placeholders while the categories load', async () => {
    vi.spyOn(api, 'fetchCategories').mockReturnValue(new Promise(() => undefined))
    const { find } = await render('admin', false)
    expect(find('categories-loading').exists()).toBe(true)
  })

  it('narrows the groups to those with what was typed in their own or their categories’ names', async () => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const { find, cards } = await render()
    const names = () => cards().map((card) => card.props('group').name)

    await find('category-search').find('input').setValue('coffee')
    expect(names()).toEqual(['Food & drink'])
    // A group that matches shows all its categories, whatever they're called.
    await find('category-search').find('input').setValue('  TRANSFERS ')
    expect(names()).toEqual(['Transfers'])
    await find('category-search').find('input').setValue('hobb')
    expect(names()).toEqual(['Hobbies'])
    expect(find('categories-none-match').exists()).toBe(false)

    await find('category-search').find('input').setValue('nothing like this')
    expect(names()).toEqual([])
    expect(find('categories-none-match').text()).toContain('No matching categories')

    await find('category-search').find('input').setValue('')
    expect(names()).toHaveLength(4)
  })
})
