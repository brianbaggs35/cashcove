import { flushPromises } from '@vue/test-utils'

import type { Automation } from '@/api/automations'
import { useBudgetsStore } from '@/stores/budgets'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { makeAutomation } from '@/test/automations'
import { makeBudget } from '@/test/budgets'
import { menuSettled } from '@/test/confirm'
import { click } from '@/test/dom'
import { checking, seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import AutomationCard from '@/views/automations/AutomationCard.vue'

async function render(automation: Automation, props: Record<string, unknown> = {}) {
  const mounted = await mountWithPlugins(AutomationCard, {
    width: 1280,
    props: { automation, ...props },
    session: makeSessionState({ user: makeUser({ role: 'admin' }) }),
    beforeMount: () => {
      seedFinance()
      const store = useSubscriptionsStore()
      store.subscriptions = [
        makeSubscription(),
        makeSubscription({ id: 'subscription-gym', name: 'Gym', active: false }),
      ]
      store.bills = [makeBill(), makeBill({ id: 'bill-water', name: 'Water', active: false })]
      store.loaded = true
      const budgets = useBudgetsStore()
      budgets.budgets = [makeBudget()]
      budgets.loaded = true
    },
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('AutomationCard', () => {
  it('names the automation, how many transactions match, its account and its category', async () => {
    const { find } = await render(makeAutomation({ matching_count: 1204 }))

    expect(find('automation-title').text()).toBe('Streaming')
    expect(find('automation-matches').text()).toBe('1,204 matching transactions')
    expect(find('automation-payees').text()).toBe('Netflix')
    expect(find('automation-account').text()).toBe('Any account')
    expect(find('category-chip').text()).toContain('Groceries')
    expect(find('automation-subscription').exists()).toBe(false)
    expect(find('automation-scope').text()).toBe('Past and future')
    expect(find('automation-paused-chip').exists()).toBe(false)
    expect(find('automation-idle').exists()).toBe(false)
  })

  it('says how many transactions match in the singular, and names the account', async () => {
    const { find } = await render(
      makeAutomation({ matching_count: 1, account_id: checking.id, apply_to: 'future' }),
    )

    expect(find('automation-matches').text()).toBe('1 matching transaction')
    expect(find('automation-account').text()).toBe('Everyday checking')
    expect(find('automation-scope').text()).toBe('Future only')
  })

  it('says when its account is not known', async () => {
    const { find } = await render(makeAutomation({ account_id: 'account-gone' }))
    expect(find('automation-account').text()).toBe('Account unavailable')
  })

  it.each([
    ['exact', 'Payee is'],
    ['starts_with', 'Payee starts with'],
    ['contains', 'Payee contains'],
  ] as const)('says how it compares what it looks for when it is %s', async (match, phrase) => {
    const { find } = await render(makeAutomation({ match }))
    expect(find('automation-looks').text()).toBe(phrase)
  })

  it.each([
    ['one amount', '9.99', '9.99', 'exactly $9.99'],
    ['a range', '5.00', '15.00', '$5.00 to $15.00'],
    ['a smallest amount', '5.00', null, 'at least $5.00'],
    ['a largest amount', null, '15.00', 'up to $15.00'],
  ])('says it only sorts %s', async (_name, min, max, phrase) => {
    const { find } = await render(makeAutomation({ min_amount: min, max_amount: max }))
    expect(find('automation-amounts').text()).toBe(phrase)
  })

  it('says nothing about amounts when it takes any amount', async () => {
    const { find } = await render(makeAutomation())
    expect(find('automation-amounts').exists()).toBe(false)
  })

  it('lists a few payees and counts the rest', async () => {
    const { find } = await render(
      makeAutomation({ payees: ['Netflix', 'Hulu', 'Disney+', 'Max', 'Peacock'] }),
    )
    expect(find('automation-payees').text()).toBe('NetflixHuluDisney+ +2 more')
  })

  it('names the subscription it links payments to, and when that one is paused', async () => {
    const linked = await render(
      makeAutomation({ category_id: null, subscription_id: 'subscription-streamflix' }),
    )
    expect(linked.find('automation-subscription').text()).toBe('Streamflix')
    expect(linked.find('category-chip').exists()).toBe(false)

    const paused = await render(makeAutomation({ subscription_id: 'subscription-gym' }))
    expect(paused.find('automation-subscription').text()).toBe('Gym (paused)')

    const unknown = await render(makeAutomation({ subscription_id: 'subscription-gone' }))
    expect(unknown.find('automation-subscription').text()).toBe('Subscription or bill')
  })

  it('names the bill it links payments to, with a bill’s icon, and when that one is paused', async () => {
    const linked = await render(
      makeAutomation({ category_id: null, subscription_id: 'bill-power' }),
    )
    expect(linked.find('automation-subscription').text()).toBe('City Power')
    expect(linked.wrapper.find('[data-test="automation-subscription"] svg').classes()).toContain(
      'lucide-receipt-text',
    )
    const subscription = await render(
      makeAutomation({ category_id: null, subscription_id: 'subscription-streamflix' }),
    )
    expect(
      subscription.wrapper.find('[data-test="automation-subscription"] svg').classes(),
    ).toContain('lucide-repeat')

    const paused = await render(makeAutomation({ subscription_id: 'bill-water' }))
    expect(paused.find('automation-subscription').text()).toBe('Water (paused)')
  })

  it('names the budgets it counts what it sorts toward', async () => {
    const { wrapper, find } = await render(
      makeAutomation({
        category_id: null,
        counts: [
          { budget_id: 'budget-monthly', kind: 'income' },
          { budget_id: 'budget-gone', kind: 'spending' },
        ],
      }),
    )

    expect(wrapper.findAll('[data-test="automation-budget"]').map((chip) => chip.text())).toEqual([
      'Income in Household',
      'Spending in a budget',
    ])
    // Counting is something to do, so it isn't idle.
    expect(find('automation-idle').exists()).toBe(false)
    expect(find('automation-card').text()).not.toContain('Nothing yet')
  })

  it('warns when what it gave was deleted', async () => {
    const { find } = await render(makeAutomation({ category_id: null, subscription_id: null }))
    expect(find('automation-idle').text()).toContain('was deleted')
    expect(find('automation-card').text()).toContain('Nothing yet')
  })

  it('dims a paused automation and says so', async () => {
    const { find } = await render(makeAutomation({ active: false }))
    expect(find('automation-paused-chip').text()).toBe('Paused')
    expect(find('automation-card').classes()).toContain('automation-card--paused')
  })

  it('lets admins pause, resume, edit and delete it', async () => {
    const automation = makeAutomation()
    const { wrapper, find } = await render(automation)

    const act = async (item: string) => {
      await find('automation-actions').trigger('click')
      await flushPromises()
      await click(`.v-overlay--active [data-test="${item}"]`)
      await menuSettled()
    }
    await act('automation-toggle')
    await act('automation-edit')
    await act('automation-delete')

    expect(wrapper.emitted('toggle')).toEqual([[automation]])
    expect(wrapper.emitted('edit')).toEqual([[automation]])
    expect(wrapper.emitted('delete')).toEqual([[automation]])
  })

  it('offers resuming a paused one', async () => {
    const { find } = await render(makeAutomation({ active: false }))
    await find('automation-actions').trigger('click')
    await flushPromises()
    expect(
      document.querySelector('.v-overlay--active [data-test="automation-toggle"]')?.textContent,
    ).toContain('Resume')
  })

  it('has no menu for viewers', async () => {
    const { find } = await render(makeAutomation(), { readonly: true })
    expect(find('automation-actions').exists()).toBe(false)
  })
})
