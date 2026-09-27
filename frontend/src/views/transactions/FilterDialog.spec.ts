import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { page, typeDate } from '@/test/dom'
import {
  checking,
  coffee,
  groceries,
  makeAccount,
  savings,
  seedFinance,
  visa,
} from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import FilterDialog from '@/views/transactions/FilterDialog.vue'
import { emptyFilters, type TransactionFilters } from '@/views/transactions/view'

const wallet = makeAccount({
  id: 'account-wallet',
  name: 'Wallet',
  type: 'cash',
  institution: null,
})
const oldCard = makeAccount({
  id: 'account-old',
  name: 'Old store card',
  institution: null,
  closed_at: '2026-01-01T00:00:00Z',
})

async function render(changes: Partial<TransactionFilters> = {}, focus: 'dates' | null = null) {
  const open = ref(false)
  const applied = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(FilterDialog, {
        filters: { ...emptyFilters(), q: 'coffee', ...changes },
        focus,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onApply: applied,
      }),
  })
  await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance({ accounts: [checking, savings, visa, wallet, oldCard] }),
  })
  open.value = true
  await flushPromises()
  return { open, applied }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)
const options = () =>
  page()
    .findAll('.v-menu.v-overlay--active .v-list-item, .v-menu.v-overlay--active .v-list-subheader')
    .map((item) => item.text())

/** Clicks the option in the open menu with this text. */
async function choose(text: string) {
  const option = page()
    .findAll('.v-menu.v-overlay--active .v-list-item')
    .find((item) => item.text() === text)
  if (!option) throw new Error(`No option ${text}`)
  await option.trigger('click')
  await flushPromises()
}

async function openMenu(name: string) {
  await find(name).find('.v-field').trigger('mousedown')
  await flushPromises()
}

async function apply() {
  await find('filter-apply').trigger('click')
  await flushPromises()
}

describe('FilterDialog', () => {
  it('applies the filters as they were when nothing changes', async () => {
    const { open, applied } = await render({ accounts: [visa.id], status: 'pending' })
    expect(dialog().find('h2').text()).toBe('Filters')
    expect(find('filter-start').exists()).toBe(false)

    await apply()
    expect(applied).toHaveBeenCalledWith({
      ...emptyFilters(),
      q: 'coffee',
      accounts: [visa.id],
      status: 'pending',
    })
    expect(open.value).toBe(false)
  })

  it('narrows the list by account, including closed ones', async () => {
    const { applied } = await render()
    await openMenu('filter-accounts')
    expect(options()).toEqual([
      'Everyday checkingHarbor Credit Union',
      'Rainy day fundHarbor Credit Union',
      'Rewards VisaTartan Bank',
      'Wallet',
      'Old store cardClosed',
    ])
    await choose('Rewards VisaTartan Bank')
    await apply()
    expect(applied.mock.calls[0]![0]).toMatchObject({ accounts: [visa.id] })
  })

  it('narrows the list by category, or to the uncategorized', async () => {
    const { applied } = await render({ categories: [coffee.id], uncategorized: true })
    const chips = () =>
      find('filter-categories')
        .findAll('.v-chip')
        .map((chip) => chip.text())
    expect(chips()).toEqual(['Uncategorized', '☕ Coffee'])

    await openMenu('filter-categories')
    expect(options()).toEqual([
      'Uncategorized',
      'Income',
      'Paycheck',
      'Food & drink',
      'Coffee',
      'Groceries',
      'Transfers',
      'Transfers',
    ])
    // Takes Uncategorized off and adds Groceries.
    await choose('Uncategorized')
    await choose('Groceries')
    await apply()
    expect(applied.mock.calls[0]![0]).toMatchObject({
      categories: [coffee.id, groceries.id],
      uncategorized: false,
    })
  })

  it('opens at custom dates when they were chosen as the period', async () => {
    const { applied } = await render({ period: 'this-year' }, 'dates')
    expect(find('filter-custom-dates').find('input').element).toHaveProperty('checked', true)
    expect(find('filter-start').exists()).toBe(true)
    expect(find('filter-end').exists()).toBe(true)
    await apply()
    expect(applied.mock.calls[0]![0]).toMatchObject({ period: 'custom', start: null, end: null })
  })

  it('keeps custom dates already chosen', async () => {
    const { applied } = await render(
      { period: 'custom', start: '2026-09-01', end: '2026-09-15' },
      'dates',
    )
    await apply()
    expect(applied.mock.calls[0]![0]).toMatchObject({
      period: 'custom',
      start: '2026-09-01',
      end: '2026-09-15',
    })
  })

  it('narrows the list to the days chosen', async () => {
    const { applied } = await render({}, 'dates')
    await typeDate(find('filter-start').find('input'), '09/01/2026')
    await typeDate(find('filter-end').find('input'), '09/15/2026')
    await flushPromises()
    await apply()
    expect(applied.mock.calls[0]![0]).toMatchObject({
      period: 'custom',
      start: '2026-09-01',
      end: '2026-09-15',
    })
  })

  it('closes from its close button', async () => {
    const { open, applied } = await render()
    await dialog().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(applied).not.toHaveBeenCalled()
  })

  it('turns custom dates on and off', async () => {
    const { applied } = await render({ period: 'custom', start: '2026-09-01', end: null })
    const toggle = () => find('filter-custom-dates').find('input')
    await toggle().trigger('click')
    await flushPromises()
    expect(find('filter-start').exists()).toBe(false)
    await toggle().trigger('click')
    await flushPromises()
    expect(find('filter-start').find('input').element).toHaveProperty('value', '')
    await apply()
    expect(applied.mock.calls[0]![0]).toMatchObject({ period: 'custom', start: null, end: null })
  })

  it('narrows the list by direction, status, where they came from and amount', async () => {
    const { applied } = await render()
    await find('filter-direction').findAll('button')[1]!.trigger('click')
    await find('filter-status').findAll('button')[1]!.trigger('click')
    const sources = find('filter-sources').findAll('.v-chip')
    expect(sources.map((chip) => chip.text())).toEqual([
      'Added by hand',
      'From the bank',
      'Imported from a file',
    ])
    await sources[1]!.trigger('click')
    await sources[2]!.trigger('click')
    await find('filter-min').find('input').setValue('10')
    await find('filter-max').find('input').setValue('250.5')
    await flushPromises()
    await apply()

    expect(applied).toHaveBeenCalledWith({
      ...emptyFilters(),
      q: 'coffee',
      direction: 'out',
      status: 'posted',
      sources: ['plaid', 'file'],
      min: '10.00',
      max: '250.50',
    })
  })

  it('clears every filter but the search', async () => {
    const { applied } = await render({
      accounts: [checking.id],
      period: 'custom',
      start: '2026-09-01',
      direction: 'in',
      sources: ['manual'],
      min: '5.00',
    })
    await find('filter-clear').trigger('click')
    await flushPromises()
    await apply()
    expect(applied).toHaveBeenCalledWith({ ...emptyFilters(), q: 'coffee' })
  })

  it("doesn't apply amounts it can't read", async () => {
    const { applied } = await render()
    await find('filter-min').find('input').setValue('lots')
    await flushPromises()
    expect(find('filter-apply').attributes('disabled')).toBeDefined()
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(applied).not.toHaveBeenCalled()
  })

  it('applies on Enter', async () => {
    const { applied } = await render()
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(applied).toHaveBeenCalledTimes(1)
  })

  it('closes without applying anything', async () => {
    const { open, applied } = await render()
    const cancel = dialog()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
    await cancel.trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(applied).not.toHaveBeenCalled()
  })
})
