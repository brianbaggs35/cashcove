import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { sharedCard, sharedChecking, sharedSavings } from '@/test/connections'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import AccountPicker from '@/views/connect/AccountPicker.vue'

async function render() {
  const selected = ref([sharedCard.id])
  const names = ref<Record<string, string>>({
    [sharedCard.id]: 'Rewards Visa',
    [sharedChecking.id]: 'Tartan Checking',
    [sharedSavings.id]: 'Tartan Saving',
  })
  const Host = defineComponent({
    render: () =>
      h(AccountPicker, {
        accounts: [sharedCard, sharedChecking, sharedSavings],
        showNew: true,
        selected: selected.value,
        'onUpdate:selected': (value: string[]) => (selected.value = value),
        names: names.value,
        'onUpdate:names': (value: Record<string, string>) => (names.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  return { wrapper, find, selected, names }
}

describe('AccountPicker', () => {
  it('ticks some, all or none of the accounts', async () => {
    const { find, selected } = await render()
    const all = () => find('account-picker-all').find('input').element as HTMLInputElement

    expect(all().getAttribute('aria-checked')).toBe('mixed')
    expect(all().indeterminate).toBe(true)
    await find('account-picker-all').find('input').trigger('click')
    expect(selected.value).toEqual([sharedCard.id, sharedChecking.id, sharedSavings.id])
    expect(all().getAttribute('aria-checked')).toBeNull()
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
})
