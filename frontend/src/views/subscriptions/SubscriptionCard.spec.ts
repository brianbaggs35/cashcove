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
    expect(wrapper.text()).toContain('🛒 Groceries')
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
    [0, 'Due today', true],
    [1, 'Due tomorrow', true],
    [8, 'Due Oct 15, 2026', false],
  ])('describes a payment %s days away', async (days, text, alert) => {
    const { wrapper } = await render({}, { daysUntilDue: days })
    expect(wrapper.text()).toContain(text)
    expect(wrapper.find('[data-test="subscription-due-alert"]').exists()).toBe(alert)
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
