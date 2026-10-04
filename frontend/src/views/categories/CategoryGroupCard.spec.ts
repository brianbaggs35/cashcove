import { flushPromises } from '@vue/test-utils'

import type { CategoryGroup } from '@/api/categories'
import { menuSettled } from '@/test/confirm'
import { click, page } from '@/test/dom'
import { coffee, groceries, makeCategory, makeGroups, seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import CategoryGroupCard from '@/views/categories/CategoryGroupCard.vue'

const busy = makeCategory({
  id: 'category-busy',
  name: 'Dining out',
  emoji: '🍽️',
  transaction_count: 1204,
})
const food: CategoryGroup = {
  id: 'group-food',
  name: 'Food & drink',
  kind: 'expense',
  categories: [coffee, busy, { ...groceries, transaction_count: 0 }],
}

async function render(group: CategoryGroup, role: 'admin' | 'viewer' = 'admin') {
  const mounted = await mountWithPlugins(CategoryGroupCard, {
    width: 1280,
    props: { group },
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('CategoryGroupCard', () => {
  it('lists the categories with how many transactions use each', async () => {
    const { wrapper, find } = await render(food)
    expect(wrapper.find('h3').text()).toBe('Food & drink')
    expect(find('category-group-kind').text()).toBe('Spending')
    expect(
      wrapper
        .findAll('[data-test="category-row"]')
        .map((row) => row.findAll('a span').map((part) => part.text())),
    ).toEqual([
      ['☕', 'Coffee', '1 transaction'],
      ['🍽️', 'Dining out', '1,204 transactions'],
      ['🛒', 'Groceries', 'No transactions'],
    ])
    expect(wrapper.find('section').attributes('aria-labelledby')).toBe(
      wrapper.find('h3').attributes('id'),
    )
  })

  it('links each category to its transactions', async () => {
    const { find } = await render(food)
    const link = find('category-link')
    expect(link.attributes('href')).toBe(`/transactions?category=${coffee.id}`)
    expect(link.attributes('aria-label')).toBe('Coffee: 1 transaction. See them')
  })

  it('says when a group has no categories yet', async () => {
    const [income, , hobbies] = makeGroups()
    const { wrapper } = await render(hobbies!)
    expect(wrapper.text()).toContain('No categories in this group yet.')
    const second = await render(income!)
    expect(second.find('category-group-kind').text()).toBe('Income')
  })

  it('lets admins change the group and its categories', async () => {
    const { wrapper, find } = await render(food)

    await find('category-group-actions').trigger('click')
    await flushPromises()
    await click('.v-overlay--active [data-test="category-group-edit"]')
    await menuSettled()
    await find('category-group-actions').trigger('click')
    await flushPromises()
    await click('.v-overlay--active [data-test="category-group-delete"]')
    await menuSettled()

    await wrapper.findAll('[data-test="category-actions"]')[1]!.trigger('click')
    await flushPromises()
    await click('.v-overlay--active [data-test="category-edit"]')
    await menuSettled()
    await wrapper.findAll('[data-test="category-actions"]')[1]!.trigger('click')
    await flushPromises()
    await click('.v-overlay--active [data-test="category-delete"]')
    await find('category-add').trigger('click')

    expect(wrapper.emitted('editGroup')).toEqual([[food]])
    expect(wrapper.emitted('deleteGroup')).toEqual([[food]])
    expect(wrapper.emitted('editCategory')).toEqual([[busy]])
    expect(wrapper.emitted('deleteCategory')).toEqual([[busy]])
    expect(wrapper.emitted('addCategory')).toEqual([[food]])
    expect(find('category-group-actions').attributes('aria-label')).toBe('Actions for Food & drink')
    expect(page().find('[data-test="category-actions"]').attributes('aria-label')).toBe(
      'Actions for Coffee',
    )
  })

  it('shows viewers the categories without ways to change them', async () => {
    const { find } = await render(food, 'viewer')
    expect(find('category-group-actions').exists()).toBe(false)
    expect(find('category-actions').exists()).toBe(false)
    expect(find('category-add').exists()).toBe(false)
    expect(find('category-link').exists()).toBe(true)
  })
})
