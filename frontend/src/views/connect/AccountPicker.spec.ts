import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { makeShared, sharedCard, sharedChecking, sharedSavings } from '@/test/connections'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import AccountPicker from '@/views/connect/AccountPicker.vue'

async function render(accounts = [sharedCard, sharedChecking, sharedSavings]) {
  const selected = ref([sharedCard.id])
  const separate = ref<string[]>([])
  const names = ref<Record<string, string>>({
    [sharedCard.id]: 'Rewards Visa',
    [sharedChecking.id]: 'Tartan Checking',
    [sharedSavings.id]: 'Tartan Saving',
  })
  const Host = defineComponent({
    render: () =>
      h(AccountPicker, {
        accounts,
        showNew: true,
        selected: selected.value,
        'onUpdate:selected': (value: string[]) => (selected.value = value),
        names: names.value,
        'onUpdate:names': (value: Record<string, string>) => (names.value = value),
        separate: separate.value,
        'onUpdate:separate': (value: string[]) => (separate.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  return { wrapper, find, selected, names, separate }
}

describe('AccountPicker', () => {
  it('ticks some, all or none of the accounts', async () => {
    const { find, selected } = await render()
    const all = () => find('account-picker-all').find('input').element as HTMLInputElement

    expect(all().indeterminate).toBe(true)
    await find('account-picker-all').find('input').trigger('click')
    expect(selected.value).toEqual([sharedCard.id, sharedChecking.id, sharedSavings.id])
    expect(all().indeterminate).toBe(false)
    expect(all().checked).toBe(true)
    await find('account-picker-all').find('input').trigger('click')
    expect(selected.value).toEqual([])
  })

  it('shows cards as what’s owed and marks new accounts', async () => {
    const { wrapper } = await render()
    const rows = wrapper.findAll('[data-test="account-picker-row"]')
    expect(rows[0]!.text()).toContain('$612.40')
    expect(rows[0]!.text()).toContain('owed')
    expect(rows[0]!.text()).toContain('•••• 3333 · Credit card')
    expect(rows[1]!.text()).not.toContain('owed')
    expect(rows[2]!.text()).toContain('Savings')
    expect(rows[2]!.find('[data-test="account-picker-new"]').exists()).toBe(true)
    expect(rows[0]!.classes()).toContain('account-picker__row--selected')
  })

  it('renames an account, and says what the bank calls it', async () => {
    const { wrapper, find, names } = await render()
    const rename = () => wrapper.findAll('[data-test="account-picker-rename"]')[0]!

    expect(rename().attributes('aria-label')).toBe('Rename Rewards Visa')
    await rename().trigger('click')
    expect(rename().attributes('aria-label')).toBe('Done renaming')
    expect(find('account-picker-name-field').text()).toContain(
      'The bank calls it Tartan Rewards Visa Signature.',
    )
    await find('account-picker-name-field').find('input').setValue('Travel card')
    await find('account-picker-name-field').find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(names.value[sharedCard.id]).toBe('Travel card')
    expect(find('account-picker-name-field').exists()).toBe(false)

    await wrapper.findAll('[data-test="account-picker-rename"]')[1]!.trigger('click')
    expect(find('account-picker-name-field').text()).toContain('The bank calls it Tartan Checking.')
    await wrapper.findAll('[data-test="account-picker-rename"]')[1]!.trigger('click')
    await flushPromises()
    expect(find('account-picker-name-field').exists()).toBe(false)
  })

  it('asks for a name that fits', async () => {
    const { wrapper, find } = await render()
    await wrapper.findAll('[data-test="account-picker-rename"]')[0]!.trigger('click')
    await find('account-picker-name-field').find('input').setValue('  ')
    await flushPromises()
    expect(find('account-picker-name-field').text()).toContain('Enter a name')
    await find('account-picker-name-field').find('input').setValue('x'.repeat(81))
    await flushPromises()
    expect(find('account-picker-name-field').text()).toContain('Keep it under 80 characters')
  })

  describe('for an account that matches one kept from an earlier connection', () => {
    const matching = makeShared({
      ...sharedChecking,
      reconnects: { id: 'account-bills', name: 'Joint checking', transactions: 214 },
    })

    it('says it picks the kept account and its transactions back up', async () => {
      const { find, wrapper } = await render([sharedCard, matching])
      expect(find('account-picker-reconnect').exists()).toBe(false)

      await wrapper.findAll('[data-test="account-picker-check"] input')[1]!.trigger('click')
      expect(find('account-picker-reconnect').text()).toContain(
        'Picks up your kept account “Joint checking” and its 214 transactions',
      )
      expect(find('account-picker-separate').text()).toBe('Import as a new account instead')
    })

    it('says 1 transaction when the kept account has just one', async () => {
      const single = makeShared({
        ...matching,
        reconnects: { id: 'account-bills', name: 'Joint checking', transactions: 1 },
      })
      const { find, selected } = await render([single])
      selected.value = [single.id]
      await flushPromises()
      expect(find('account-picker-reconnect').text()).toContain('and its 1 transaction, so')
    })

    it('imports it as a new account instead, and back again', async () => {
      const { find, selected, separate, names } = await render([sharedCard, matching])
      selected.value = [matching.id]
      await flushPromises()

      await find('account-picker-separate').trigger('click')
      expect(separate.value).toEqual([matching.id])
      expect(names.value[matching.id]).toBe('Tartan Checking')
      expect(find('account-picker-reconnect').text()).toContain(
        'Imports as a new account, apart from your kept “Joint checking”.',
      )
      expect(find('account-picker-reuse').text()).toBe('Pick up “Joint checking” instead')

      await find('account-picker-reuse').trigger('click')
      expect(separate.value).toEqual([])
      expect(names.value[matching.id]).toBe('Joint checking')
      expect(find('account-picker-separate').exists()).toBe(true)
    })
  })
})
