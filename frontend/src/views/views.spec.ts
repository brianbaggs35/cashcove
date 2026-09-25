import AccountsView from '@/views/AccountsView.vue'
import BudgetView from '@/views/BudgetView.vue'
import ConnectView from '@/views/ConnectView.vue'
import ImportView from '@/views/ImportView.vue'
import NotFoundView from '@/views/NotFoundView.vue'
import SubscriptionsView from '@/views/SubscriptionsView.vue'
import TransactionsView from '@/views/TransactionsView.vue'
import { mountWithPlugins } from '@/test/mount'

describe('tab views', () => {
  it.each([
    ['Accounts', AccountsView],
    ['Budget', BudgetView],
    ['Subscriptions', SubscriptionsView],
    ['Transactions', TransactionsView],
    ['Import', ImportView],
    ['Connect', ConnectView],
  ])('%s renders its header', async (title, view) => {
    const { wrapper } = await mountWithPlugins(view)
    expect(wrapper.find('h1').text()).toBe(title)
    wrapper.unmount()
  })

  it('the not-found page links back to Accounts', async () => {
    const { wrapper } = await mountWithPlugins(NotFoundView)
    expect(wrapper.text()).toContain('Page not found')
    expect(wrapper.find('a').attributes('href')).toBe('/accounts')
    wrapper.unmount()
  })
})
