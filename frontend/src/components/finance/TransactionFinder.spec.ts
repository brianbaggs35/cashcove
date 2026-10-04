import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/transactions'

import TransactionFinder from '@/components/finance/TransactionFinder.vue'
import { latte, makePage, makeTransaction, salary, seedFinance, wholeFoods } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'

async function render(
  props: Record<string, unknown> = {},
  slots: Record<string, string> = {},
  page = makePage(),
) {
  const fetch = vi.spyOn(api, 'fetchTransactions').mockResolvedValue(page)
  const mounted = await mountWithPlugins(TransactionFinder, {
    props,
    slots,
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, fetch, find }
}

describe('TransactionFinder', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists the newest transactions with what they were, when, where and how much', async () => {
    const { wrapper, fetch, find } = await render()

    expect(fetch).toHaveBeenCalledWith({ page_size: 25, sort: '-date' })
    const rows = wrapper.findAll('[data-test="finder-row"]')
    expect(rows.map((row) => row.find('.v-list-item-title').text())).toEqual([
      'Blue Bottle',
      'Whole Foods',
      'Acme Corp',
    ])
    expect(rows[1]!.find('.v-list-item-subtitle').text()).toBe(
      'Sep 18 · Everyday checking · Groceries',
    )
    expect(rows[0]!.text()).toContain('-$4.50')
    expect(rows[2]!.text()).toContain('+$2,400.00')
    expect(find('finder-more').exists()).toBe(false)
  })

  it('says when a transaction has no category or its account is gone', async () => {
    const stray = makeTransaction({
      id: 'transaction-stray',
      account_id: 'gone',
      category_id: null,
    })
    const { wrapper } = await render({}, {}, makePage([stray]))

    expect(wrapper.find('.v-list-item-subtitle').text()).toBe(
      'Sep 18 · Deleted account · Uncategorized',
    )
  })

  it('asks only for payments, or for what one subscription tracks', async () => {
    const { fetch, wrapper } = await render({ direction: 'out', subscriptionId: 'subscription-1' })

    expect(fetch).toHaveBeenLastCalledWith({
      direction: 'out',
      subscription_id: 'subscription-1',
      page_size: 25,
      sort: '-date',
    })
    await wrapper.setProps({ subscriptionId: null })
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ direction: 'out', page_size: 25, sort: '-date' })
    await wrapper.setProps({ direction: 'in', pageSize: 10 })
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ direction: 'in', page_size: 10, sort: '-date' })
  })

  it('searches once typing pauses, and again when the search is cleared', async () => {
    const { fetch, find } = await render()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const input = find('finder-search').find('input')

    await input.setValue('who')
    await input.setValue(' whole ')
    vi.advanceTimersByTime(299)
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ q: 'whole', page_size: 25, sort: '-date' })

    await find('finder-search').find('.v-field__clearable .v-icon').trigger('click')
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ page_size: 25, sort: '-date' })
  })

  it('offers a switch for transactions without a category only when asked', async () => {
    const without = await render()
    expect(without.find('finder-uncategorized').exists()).toBe(false)

    const { fetch, find } = await render({ uncategorizedSwitch: true })
    await find('finder-uncategorized').find('input').setValue(true)
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ uncategorized: true, page_size: 25, sort: '-date' })
  })

  it('says how many more there are than it lists', async () => {
    const { find } = await render({}, {}, makePage([wholeFoods, latte], { total: 140 }))
    expect(find('finder-more').text()).toBe(
      'Showing the newest 2 of 140. Search to narrow them down.',
    )
  })

  it('says when nothing was found', async () => {
    const { find } = await render({}, {}, makePage([]))
    expect(find('finder-empty').text()).toContain('No transactions found')
    expect(find('finder-list').exists()).toBe(false)
  })

  it('lets the parent put something before and after each transaction', async () => {
    const { wrapper } = await render(
      {},
      {
        prepend:
          '<template #prepend="{ transaction }"><i class="before">{{ transaction.id }}</i></template>',
        append:
          '<template #append="{ transaction }"><b class="after">{{ transaction.payee }}</b></template>',
      },
      makePage([wholeFoods, salary]),
    )

    expect(wrapper.findAll('.before').map((item) => item.text())).toEqual([
      'transaction-groceries',
      'transaction-salary',
    ])
    expect(wrapper.findAll('.after').map((item) => item.text())).toEqual([
      'Whole Foods',
      'Acme Corp',
    ])
  })

  it('says why it could not load, and tries again', async () => {
    const fetch = vi
      .spyOn(api, 'fetchTransactions')
      .mockRejectedValueOnce(new Error("Can't reach Cashcove."))
      .mockResolvedValue(makePage([wholeFoods]))
    const { wrapper } = await mountWithPlugins(TransactionFinder, {
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    expect(wrapper.find('[data-test="finder-error"]').text()).toContain(
      "Couldn't load the transactions. Can't reach Cashcove.",
    )
    await wrapper.find('[data-test="finder-retry"]').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-test="finder-row"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="finder-error"]').exists()).toBe(false)
  })

  it('shows placeholders until the first answer comes', async () => {
    vi.spyOn(api, 'fetchTransactions').mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await mountWithPlugins(TransactionFinder, {
      beforeMount: () => seedFinance(),
    })

    expect(wrapper.find('[data-test="finder-loading"]').exists()).toBe(true)
  })

  it('only shows the answer to the latest search, and reloads on request', async () => {
    const answers: ((page: api.TransactionPage) => void)[] = []
    const fetch = vi.spyOn(api, 'fetchTransactions').mockImplementation(
      () =>
        new Promise((resolve) => {
          answers.push(resolve)
        }),
    )
    const { wrapper } = await mountWithPlugins(TransactionFinder, {
      beforeMount: () => seedFinance(),
    })
    const finder = wrapper.vm as unknown as { reload: () => Promise<void> }

    void finder.reload()
    expect(fetch).toHaveBeenCalledTimes(2)
    const [first, second] = answers
    second!(makePage([wholeFoods]))
    await flushPromises()
    first!(makePage([latte, salary]))
    await flushPromises()

    expect(wrapper.findAll('[data-test="finder-row"]')).toHaveLength(1)
    expect(wrapper.find('.v-list-item-title').text()).toBe('Whole Foods')
  })

  it('ignores a failure that a newer request has replaced', async () => {
    const answers: { resolve: (page: api.TransactionPage) => void; reject: (e: Error) => void }[] =
      []
    vi.spyOn(api, 'fetchTransactions').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answers.push({ resolve, reject })
        }),
    )
    const { wrapper } = await mountWithPlugins(TransactionFinder, {
      beforeMount: () => seedFinance(),
    })
    const finder = wrapper.vm as unknown as { reload: () => Promise<void> }

    void finder.reload()
    answers[0]!.reject(new Error('Too slow'))
    await flushPromises()
    answers[1]!.resolve(makePage([wholeFoods]))
    await flushPromises()

    expect(wrapper.find('[data-test="finder-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="finder-row"]')).toHaveLength(1)
  })

  it('keeps no search waiting when it goes away', async () => {
    const { wrapper, fetch, find } = await render()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    await find('finder-search').find('input').setValue('whole')
    wrapper.unmount()
    vi.advanceTimersByTime(1000)

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
