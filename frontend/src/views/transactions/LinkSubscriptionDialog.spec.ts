import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as billsApi from '@/api/bills'
import { ApiError } from '@/api/client'
import * as api from '@/api/subscriptions'
import { notices } from '@/composables/notify'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import LinkSubscriptionDialog from '@/views/transactions/LinkSubscriptionDialog.vue'

const power = makeSubscription({
  id: 'subscription-power',
  name: 'Power',
  amount: '100.00',
  amount_varies: true,
  expected_amount: '120.00',
  frequency: 'monthly',
})

async function render(ids: string[], selected = ids.length) {
  const open = ref(false)
  const done = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(LinkSubscriptionDialog, {
        ids,
        selected,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onDone: done,
      }),
  })
  const fetch = vi
    .spyOn(api, 'fetchSubscriptions')
    .mockResolvedValue([
      makeSubscription(),
      power,
      makeSubscription({ id: 'subscription-paused', name: 'Old gym', active: false }),
    ])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([
    makeBill(),
    makeBill({ id: 'bill-old', name: 'Old gas', active: false }),
  ])
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  open.value = true
  await flushPromises()
  const select = () => wrapper.findComponent({ name: 'VSelect' })
  return { open, done, fetch, select }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')

async function apply() {
  await dialog().find('[data-test="link-apply"]').trigger('click')
  await flushPromises()
}

describe('LinkSubscriptionDialog', () => {
  it('links the selected payments to the subscription chosen', async () => {
    const link = vi
      .spyOn(api, 'linkSubscriptionPayments')
      .mockResolvedValue({ count: 2, subscription: makeSubscription() })
    const { open, done, select } = await render(['a', 'b'])
    expect(dialog().find('h2').text()).toBe('Link 2 payments to a subscription or bill')
    expect(dialog().find('[data-test="link-apply"]').attributes('disabled')).toBeDefined()

    select().vm.$emit('update:modelValue', 'subscription-power')
    await flushPromises()
    await apply()

    expect(link).toHaveBeenCalledWith('subscription-power', ['a', 'b'])
    expect(notices.value.at(-1)?.text).toBe('Linked 2 payments to Power')
    expect(done).toHaveBeenCalled()
    expect(open.value).toBe(false)
  })

  it('links them to a bill through the bills API', async () => {
    const linkBill = vi
      .spyOn(billsApi, 'linkBillPayments')
      .mockResolvedValue({ count: 1, subscription: makeBill() })
    const linkSubscription = vi.spyOn(api, 'linkSubscriptionPayments')
    const { done, select } = await render(['a'])
    expect(dialog().find('h2').text()).toBe('Link 1 payment to a subscription or bill')

    select().vm.$emit('update:modelValue', 'bill-power')
    await flushPromises()
    await apply()

    expect(linkBill).toHaveBeenCalledWith('bill-power', ['a'])
    expect(linkSubscription).not.toHaveBeenCalled()
    expect(notices.value.at(-1)?.text).toBe('Linked 1 payment to City Power')
    expect(done).toHaveBeenCalled()
  })

  it('offers the subscriptions and the bills still being matched, with how often and how much', async () => {
    const { select } = await render(['a'])

    expect(select().props('items')).toEqual([
      { type: 'subheader', title: 'Subscriptions' },
      {
        value: 'subscription-streamflix',
        title: 'Streamflix',
        props: { subtitle: 'Monthly · $14.99' },
      },
      { value: 'subscription-power', title: 'Power', props: { subtitle: 'Monthly · $120.00' } },
      { type: 'subheader', title: 'Bills' },
      { value: 'bill-power', title: 'City Power', props: { subtitle: 'Monthly · $96.40' } },
    ])
  })

  it('says when they were all linked already', async () => {
    vi.spyOn(api, 'linkSubscriptionPayments').mockResolvedValue({
      count: 0,
      subscription: makeSubscription(),
    })
    const { select } = await render(['a'])
    expect(dialog().find('h2').text()).toBe('Link 1 payment to a subscription or bill')

    select().vm.$emit('update:modelValue', 'subscription-streamflix')
    await flushPromises()
    await apply()

    expect(notices.value.at(-1)?.text).toBe('1 payment already linked to Streamflix')
  })

  it('names one that is no longer in the list only as it', async () => {
    vi.spyOn(api, 'linkSubscriptionPayments').mockResolvedValue({
      count: 1,
      subscription: makeSubscription(),
    })
    const { select } = await render(['a'])

    select().vm.$emit('update:modelValue', 'subscription-gone')
    await flushPromises()
    await apply()

    expect(notices.value.at(-1)?.text).toBe('Linked 1 payment to it')
  })

  it('says which of the selected were left out because money came in', async () => {
    await render(['a'], 2)

    expect(page().find('[data-test="link-skipped"]').text()).toContain(
      '1 selected transaction is money coming in',
    )
    expect(page().find('[data-test="link-skipped"]').text()).toContain('it stays as it is')
  })

  it('says how many were left out when there are several', async () => {
    await render(['a'], 4)

    expect(page().find('[data-test="link-skipped"]').text()).toContain(
      '3 selected transactions are money coming in',
    )
    expect(page().find('[data-test="link-skipped"]').text()).toContain('they stay as they are')
  })

  it('says nothing about transactions left out when there are none', async () => {
    await render(['a', 'b'])

    expect(page().find('[data-test="link-skipped"]').exists()).toBe(false)
  })

  it('says what went wrong and starts afresh when opened again', async () => {
    vi.spyOn(api, 'linkSubscriptionPayments').mockRejectedValue(
      new ApiError(404, 'That subscription no longer exists.'),
    )
    const { open, done, select, fetch } = await render(['a'])
    select().vm.$emit('update:modelValue', 'subscription-streamflix')
    await flushPromises()
    await apply()

    expect(dialog().find('[data-test="link-error"]').text()).toBe(
      'That subscription no longer exists.',
    )
    expect(done).not.toHaveBeenCalled()
    expect(open.value).toBe(true)

    open.value = false
    await flushPromises()
    open.value = true
    await flushPromises()
    expect(dialog().find('[data-test="link-error"]').exists()).toBe(false)
    expect(dialog().find('[data-test="link-apply"]').attributes('disabled')).toBeDefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('closes from the dialog’s own close button', async () => {
    const { open } = await render(['a'])

    await dialog().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
  })

  it('closes without linking anything', async () => {
    const link = vi.spyOn(api, 'linkSubscriptionPayments')
    const { open } = await render(['a'])

    await dialog()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')

    expect(open.value).toBe(false)
    expect(link).not.toHaveBeenCalled()
  })
})
