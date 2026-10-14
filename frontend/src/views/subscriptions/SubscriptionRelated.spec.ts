import { mountWithPlugins } from '@/test/mount'
import SubscriptionRelated from '@/views/subscriptions/SubscriptionRelated.vue'

describe('SubscriptionRelated', () => {
  it('names the automations that link its payments, the paused ones too, and where to change them', async () => {
    const { wrapper } = await mountWithPlugins(SubscriptionRelated, {
      props: {
        kind: 'bill',
        automations: [
          { id: 'a1', name: 'Electric company', active: true },
          { id: 'a2', name: 'Old spelling', active: false },
        ],
        budgets: [],
      },
    })

    const items = wrapper.findAll('[data-test="related-automations"] li')
    expect(items.map((item) => item.find('a').text())).toEqual([
      'Electric company',
      'Old spelling Paused',
    ])
    expect(items[0]!.find('a').attributes('href')).toBe('/automations')
    expect(items[0]!.text()).not.toContain('Paused')
    expect(wrapper.find('[data-test="related-no-automations"]').exists()).toBe(false)
  })

  it('names the budgets that count its payments, how often each starts over, and opens each', async () => {
    const { wrapper } = await mountWithPlugins(SubscriptionRelated, {
      props: {
        kind: 'subscription',
        automations: [],
        budgets: [
          { id: 'b1', name: 'Home', period: 'monthly' },
          { id: 'b2', name: 'Treats', period: 'biweekly' },
        ],
      },
    })

    const items = wrapper.findAll('[data-test="related-budgets"] li')
    expect(items.map((item) => item.find('span').text())).toEqual(['Home', 'Treats'])
    expect(items.map((item) => item.find('.v-chip').text())).toEqual(['Monthly', 'Every two weeks'])
    expect(items[0]!.find('a').attributes('href')).toBe('/budget?budget=b1')
    expect(wrapper.find('[data-test="related-no-budgets"]').exists()).toBe(false)
  })

  it('says what to do when nothing refers to it, in the words of its kind', async () => {
    const { wrapper: bill } = await mountWithPlugins(SubscriptionRelated, {
      props: { kind: 'bill', automations: [], budgets: [] },
    })
    expect(bill.find('[data-test="related-no-automations"]').text()).toContain(
      'No automation links payments to this bill',
    )
    expect(bill.find('[data-test="related-no-budgets"]').text()).toContain(
      'No budget counts its payments as spending',
    )

    const { wrapper: subscription } = await mountWithPlugins(SubscriptionRelated, {
      props: { kind: 'subscription', automations: [], budgets: [] },
    })
    expect(subscription.find('[data-test="related-no-automations"]').text()).toContain(
      'to this subscription',
    )
    expect(subscription.find('[data-test="related-automations"]').exists()).toBe(false)
  })
})
