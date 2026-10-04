import { flushPromises } from '@vue/test-utils'

import { checking, seedFinance } from '@/test/finance'
import { makeSubscription } from '@/test/subscriptions'
import { mountWithPlugins } from '@/test/mount'
import { page } from '@/test/dom'
import SubscriptionCard from '@/views/subscriptions/SubscriptionCard.vue'

async function render(changes: Partial<Parameters<typeof makeSubscription>[0]> = {}, props = {}) {
  const edit = vi.fn()
  const remove = vi.fn()
  const toggle = vi.fn()
  const { wrapper } = await mountWithPlugins(SubscriptionCard, {
    props: {
      subscription: makeSubscription(changes),
      daysUntilDue: 8,
      alertDays: 3,
      dueAlertsEnabled: true,
      ...props,
    },
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  return { wrapper, edit, remove, toggle }
}

describe('SubscriptionCard', () => {
  it('shows recurring cost, category, account, payment count, and its payment history link', async () => {
    const { wrapper } = await render()

    expect(wrapper.find('[data-test="subscription-title"]').text()).toBe('Streamflix')
    expect(wrapper.find('[data-test="subscription-amount"]').text()).toBe('$14.99')
    expect(wrapper.text()).toContain('$14.99 / month')
    expect(wrapper.text()).toContain('Everyday checking')
    expect(wrapper.find('[data-test="category-chip"]').text()).toContain('Groceries')
    expect(wrapper.find('[data-test="subscription-payment-count"]').text()).toContain(
      '2 payments tracked',
    )
    expect(wrapper.find('[data-test="subscription-view-payments"]').attributes('href')).toContain(
      '/transactions?subscription=subscription-streamflix',
    )
    expect(wrapper.find('[data-test="subscription-due-alert"]').exists()).toBe(false)
  })

  it.each([
    [-2, 'Overdue by 2 days', false],
    [-1, 'Overdue by 1 day', false],
    [0, 'Due today', true],
    [1, 'Due tomorrow', true],
    [8, 'Due Oct 15, 2026', false],
  ])('describes a payment %s days away', async (days, text, alert) => {
    const { wrapper } = await render({}, { daysUntilDue: days })
    expect(wrapper.text()).toContain(text)
    expect(wrapper.find('[data-test="subscription-due-alert"]').exists()).toBe(alert)
  })

  it('shows an overdue payment in the error color, and no other', async () => {
    const { wrapper: overdue } = await render({}, { daysUntilDue: -3 })
    expect(overdue.find('[data-test="subscription-due"]').classes()).toContain('text-error')
    const { wrapper: upcoming } = await render({}, { daysUntilDue: 3 })
    expect(upcoming.find('[data-test="subscription-due"]').classes()).not.toContain('text-error')
  })

  it('says when the latest payment was made, once there is one', async () => {
    const { wrapper } = await render({ last_payment_on: '2026-09-15' })
    expect(wrapper.find('[data-test="subscription-last-payment"]').text()).toBe(
      'Last payment Sep 15, 2026 · $14.99',
    )
    const { wrapper: none } = await render({ last_payment_on: null, payment_count: 0 })
    expect(none.find('[data-test="subscription-last-payment"]').exists()).toBe(false)
  })

  it('says when the latest payment was made, even without what it was for', async () => {
    const { wrapper } = await render({ last_payment_on: '2026-09-15', last_payment_amount: null })
    expect(wrapper.find('[data-test="subscription-last-payment"]').text()).toBe(
      'Last payment Sep 15, 2026',
    )
  })

  it('shows a bill that changes every time as an estimate, and what was last paid', async () => {
    const { wrapper } = await render({
      name: 'Power',
      amount: '100.00',
      amount_varies: true,
      expected_amount: '115.00',
      typical_amount: '115.00',
      last_payment_amount: '140.01',
    })

    expect(wrapper.find('[data-test="subscription-amount"]').text()).toBe('~ $115.00')
    expect(wrapper.find('[data-test="subscription-varies"]').text()).toBe('Amount varies')
    expect(wrapper.text()).toContain('$115.00 / month')
    expect(wrapper.find('[data-test="subscription-last-payment"]').text()).toContain('$140.01')
    // Its payments are never a change of price.
    expect(wrapper.find('[data-test="subscription-price-change"]').exists()).toBe(false)
  })

  it('does not call a fixed amount an estimate', async () => {
    const { wrapper } = await render()
    expect(wrapper.find('[data-test="subscription-amount"]').text()).toBe('$14.99')
    expect(wrapper.find('[data-test="subscription-varies"]').exists()).toBe(false)
  })

  it('notices when the last payment was not what the subscription says, and offers the new amount', async () => {
    const subscription = makeSubscription({ amount: '15.49', last_payment_amount: '17.99' })
    const { wrapper } = await render({ amount: '15.49', last_payment_amount: '17.99' })

    expect(wrapper.find('[data-test="subscription-price-change"]').text()).toContain(
      'The last payment was $17.99, not $15.49.',
    )
    await wrapper.find('[data-test="subscription-update-amount"]').trigger('click')

    expect(wrapper.emitted('update-amount')?.[0]).toEqual([subscription])
  })

  it('leaves the price alone for viewers, and says nothing when payments match or there are none', async () => {
    const { wrapper: viewer } = await render(
      { amount: '15.49', last_payment_amount: '17.99' },
      { readonly: true },
    )
    expect(viewer.find('[data-test="subscription-price-change"]').exists()).toBe(true)
    expect(viewer.find('[data-test="subscription-update-amount"]').exists()).toBe(false)

    const { wrapper: same } = await render()
    expect(same.find('[data-test="subscription-price-change"]').exists()).toBe(false)
    const { wrapper: none } = await render({ last_payment_amount: null, last_payment_on: null })
    expect(none.find('[data-test="subscription-price-change"]').exists()).toBe(false)
  })

  it('hides the alert when reminders are disabled or outside the chosen window', async () => {
    const { wrapper: disabled } = await render({}, { dueAlertsEnabled: false, daysUntilDue: 0 })
    expect(disabled.find('[data-test="subscription-due-alert"]').exists()).toBe(false)
    const { wrapper: late } = await render({}, { alertDays: 0, daysUntilDue: 1 })
    expect(late.find('[data-test="subscription-due-alert"]').exists()).toBe(false)
  })

  it('supports all recurrence labels and a singular payment count', async () => {
    const labels = [
      ['weekly', 'Weekly'],
      ['biweekly', 'Every two weeks'],
      ['monthly', 'Monthly'],
      ['quarterly', 'Every three months'],
      ['semiannual', 'Every six months'],
      ['annual', 'Annually'],
    ] as const
    for (const [frequency, label] of labels) {
      const { wrapper } = await render({ frequency, payment_count: 1 })
      expect(wrapper.text()).toContain(label)
      expect(wrapper.find('[data-test="subscription-payment-count"]').text()).toContain(
        '1 payment tracked',
      )
    }
  })

  it('keeps paused and missing account/category states understandable', async () => {
    const { wrapper } = await render(
      {
        active: false,
        account_id: 'deleted-account',
        category_id: null,
        payment_count: 0,
      },
      { readonly: true },
    )
    expect(wrapper.find('[data-test="subscription-paused-chip"]').text()).toBe('Paused')
    expect(wrapper.find('[data-test="subscription-actions"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="subscription-link-payments"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="category-chip"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Account unavailable')
    expect(wrapper.find('[data-test="subscription-payment-count"]').text()).toContain(
      '0 payments tracked',
    )
    expect(wrapper.find('[data-test="subscription-due-alert"]').exists()).toBe(false)
  })

  it('emits pause, edit and delete actions from the Vuetify menu', async () => {
    const subscription = makeSubscription()
    const { wrapper } = await render()
    const open = async () => {
      await wrapper.find('[data-test="subscription-actions"]').trigger('click')
      await flushPromises()
    }

    await open()
    await page().find('[data-test="subscription-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('toggle')?.[0]).toEqual([subscription])

    await open()
    await page().find('[data-test="subscription-edit"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('edit')?.[0]).toEqual([subscription])

    await open()
    await page().find('[data-test="subscription-delete"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('delete')?.[0]).toEqual([subscription])
  })

  it('asks to link payments from its button', async () => {
    const subscription = makeSubscription()
    const { wrapper } = await render()

    await wrapper.find('[data-test="subscription-link-payments"]').trigger('click')

    expect(wrapper.emitted('link')?.[0]).toEqual([subscription])
  })

  it('offers resume for a paused subscription', async () => {
    const subscription = makeSubscription({ active: false })
    const { wrapper } = await render({ active: false })
    await wrapper.find('[data-test="subscription-actions"]').trigger('click')
    await flushPromises()
    expect(page().find('[data-test="subscription-toggle"]').text()).toContain('Resume matching')
    await page().find('[data-test="subscription-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('toggle')?.[0]).toEqual([subscription])
  })

  it('uses an account currency that differs from the household currency', async () => {
    const { wrapper } = await mountWithPlugins(SubscriptionCard, {
      props: {
        subscription: makeSubscription(),
        daysUntilDue: 1,
        alertDays: 3,
        dueAlertsEnabled: true,
      },
      beforeMount: () => {
        seedFinance({
          accounts: [checking],
        }).accounts.put({ ...checking, currency: 'CAD' })
      },
    })
    await flushPromises()
    expect(wrapper.find('[data-test="subscription-amount"]').text()).toContain('CA$14.99')
  })
})
