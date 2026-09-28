import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as api from '@/api/accounts'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'
import { click, page } from '@/test/dom'
import { checking, makeAccount, seedFinance, visa } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import AccountDialog from '@/views/accounts/AccountDialog.vue'

async function render(
  account: api.Account | null = null,
  draft: Partial<api.AccountInput> | null = null,
) {
  const open = ref(false)
  const saved = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(AccountDialog, {
        account,
        draft,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
      }),
  })
  await mountWithPlugins(Host, { width: 1280, beforeMount: () => seedFinance({ accounts: [] }) })
  open.value = true
  await flushPromises()
  return { open, saved }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const field = (name: string) => dialog().find(`[data-test="account-${name}"]`)
const input = (name: string) => field(name).find('input, textarea')
const value = (name: string) => (input(name).element as HTMLInputElement).value
const save = () => dialog().find('[data-test="account-save"]')

async function fill(values: Record<string, string>) {
  for (const [name, text] of Object.entries(values)) await input(name).setValue(text)
  await flushPromises()
}

async function submit() {
  await save().trigger('click')
  await flushPromises()
}

describe('AccountDialog', () => {
  it('adds an account kept by hand', async () => {
    const saved = makeAccount({ id: 'account-new', name: 'Rainy day fund', type: 'savings' })
    const create = vi.spyOn(api, 'createAccount').mockResolvedValue(saved)
    const { open } = await render()
    expect(dialog().find('h2').text()).toBe('Add an account')
    expect(field('type-checking').attributes('aria-checked')).toBe('true')
    // Real buttons, so the keyboard reaches and presses them.
    expect(field('type-savings').element.tagName).toBe('BUTTON')
    expect(field('type-savings').attributes('type')).toBe('button')
    expect(field('credit-limit').exists()).toBe(false)
    expect(save().attributes('disabled')).toBeDefined()

    await field('type-savings').trigger('click')
    await fill({
      'name-field': '  Rainy day fund ',
      institution: ' Harbor Credit Union ',
      mask: '9921',
      'balance-field': '2,500',
      notes: '  ',
    })
    expect(field('balance-field').text()).toContain('Current balance')
    await submit()

    expect(create).toHaveBeenCalledWith({
      name: 'Rainy day fund',
      notes: null,
      type: 'savings',
      institution: 'Harbor Credit Union',
      mask: '9921',
      currency: 'USD',
      balance: '2500.00',
      credit_limit: null,
    })
    expect(useAccountsStore().find('account-new')).toEqual(saved)
    expect(notices.value.at(-1)?.text).toBe('Added Rainy day fund')
    expect(open.value).toBe(false)
  })

  it('starts a new account from a draft, and says which it added', async () => {
    const added = makeAccount({ id: 'account-new', name: 'Harbor savings', type: 'savings' })
    const create = vi.spyOn(api, 'createAccount').mockResolvedValue(added)
    const { saved } = await render(null, {
      name: 'Harbor savings',
      type: 'savings',
      institution: 'Harbor Credit Union',
      mask: '7781',
      currency: 'EUR',
      balance: '2781.88',
    })
    expect(field('type-savings').attributes('aria-checked')).toBe('true')
    expect(value('name-field')).toBe('Harbor savings')
    expect(value('institution')).toBe('Harbor Credit Union')
    expect(value('mask')).toBe('7781')
    expect(field('currency').text()).toContain('EUR')
    expect(value('balance-field')).toBe('2,781.88')

    await submit()
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Harbor savings', currency: 'EUR', balance: '2781.88' }),
    )
    expect(saved).toHaveBeenCalledWith(added)
  })

  it('shows a drafted card’s balance as what’s owed', async () => {
    await render(null, { type: 'credit_card', balance: '-600.00' })
    expect(value('balance-field')).toBe('600.00')
  })

  it('takes a drafted balance without a kind of account as a checking account’s', async () => {
    await render(null, { balance: '100.00' })
    expect(field('type-checking').attributes('aria-checked')).toBe('true')
    expect(value('balance-field')).toBe('100.00')
    expect(value('name-field')).toBe('')
  })

  it('edits an account as it is, whatever the draft says', async () => {
    await render(checking, { name: 'Harbor savings', type: 'savings', balance: '1.00' })
    expect(value('name-field')).toBe('Everyday checking')
    expect(value('balance-field')).toBe('2,450.18')
  })

  it('takes what is owed on a card as a positive amount, with its limit', async () => {
    const create = vi.spyOn(api, 'createAccount').mockResolvedValue(visa)
    await render()
    await field('type-credit_card').trigger('click')
    await flushPromises()
    expect(field('balance-field').text()).toContain('Amount owed')
    await fill({ 'name-field': 'Travel card', 'balance-field': '612.40', 'credit-limit': '5000' })
    await dialog().find('form').trigger('submit')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'credit_card', balance: '-612.40', credit_limit: '5000.00' }),
    )
  })

  it('edits an account kept by hand', async () => {
    const card = makeAccount({
      type: 'credit_card',
      balance: '-100.00',
      credit_limit: '900.00',
      notes: 'Joint',
      currency: 'EUR',
    })
    const update = vi
      .spyOn(api, 'updateAccount')
      .mockResolvedValue({ ...card, name: 'Shared card' })
    await render(card)
    expect(dialog().find('h2').text()).toBe('Edit Everyday checking')
    expect(value('balance-field')).toBe('100.00')
    expect(value('credit-limit')).toBe('900.00')
    expect(value('notes')).toBe('Joint')

    await fill({ 'name-field': 'Shared card', mask: '' })
    await submit()

    expect(update).toHaveBeenCalledWith(card.id, {
      name: 'Shared card',
      notes: 'Joint',
      type: 'credit_card',
      institution: 'Harbor Credit Union',
      mask: null,
      currency: 'EUR',
      balance: '-100.00',
      credit_limit: '900.00',
    })
    expect(notices.value.at(-1)?.text).toBe('Saved Shared card')
  })

  it('only renames a linked account and changes its notes', async () => {
    const update = vi.spyOn(api, 'updateAccount').mockResolvedValue(visa)
    await render(visa)
    expect(dialog().text()).toContain('Plaid keeps this account')
    expect(field('linked-notice').text()).toBe('Tartan Rewards Visa Signature at Tartan Bank')
    for (const name of ['type-checking', 'institution', 'mask', 'balance-field', 'currency']) {
      expect(field(name).exists()).toBe(false)
    }

    await fill({ notes: 'Travel only' })
    await submit()

    expect(update).toHaveBeenCalledWith(visa.id, { name: 'Rewards Visa', notes: 'Travel only' })
  })

  it('keeps an account in another currency', async () => {
    const create = vi.spyOn(api, 'createAccount').mockResolvedValue(makeAccount())
    await render()
    await fill({ 'name-field': 'Euro savings', 'balance-field': '300' })
    await field('currency').find('.v-field').trigger('mousedown')
    await flushPromises()
    const euro = page()
      .findAll('.v-menu.v-overlay--active .v-list-item')
      .find((item) => item.text().includes('EUR'))!
    await euro.trigger('click')
    await flushPromises()
    await submit()
    expect(create.mock.calls[0]![0]).toMatchObject({ currency: 'EUR', balance: '300.00' })
  })

  it('names a linked account by its own name when the bank gives none', async () => {
    await render({ ...visa, official_name: null, institution: null })
    expect(field('linked-notice').text()).toBe('Rewards Visa')
  })

  it('checks the details before saving', async () => {
    const create = vi.spyOn(api, 'createAccount')
    await render()
    await fill({
      'name-field': ' ',
      mask: '1',
      institution: 'x'.repeat(81),
      notes: 'x'.repeat(501),
    })
    expect(field('name-field').text()).toContain('Give the account a name')
    expect(field('mask').text()).toContain('Enter 2 to 4 letters or digits')
    expect(field('institution').text()).toContain('Keep it under 80 characters')
    expect(field('notes').text()).toContain('Keep notes under 500 characters')
    await fill({ 'name-field': 'x'.repeat(81) })
    expect(field('name-field').text()).toContain('Keep it under 80 characters')
    await dialog().find('form').trigger('submit')
    expect(save().attributes('disabled')).toBeDefined()
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    [new ApiError(422, 'Check the fields.', { fields: { mask: 'That looks wrong.' } }), 'mask'],
    [new ApiError(500, 'Cashcove ran into a problem.'), 'error'],
  ])('shows why saving failed', async (error, where) => {
    vi.spyOn(api, 'createAccount').mockRejectedValue(error)
    const { open } = await render()
    await fill({ 'name-field': 'Wallet', 'balance-field': '20' })
    await submit()
    expect(field(where).text()).toContain(error.fields.mask ?? error.message)
    expect(field('error').exists()).toBe(where === 'error')
    expect(open.value).toBe(true)
  })

  it('lets a rejected account be fixed and sent again', async () => {
    const create = vi
      .spyOn(api, 'createAccount')
      .mockRejectedValueOnce(
        new ApiError(422, 'Check the fields.', { fields: { mask: 'That looks wrong.' } }),
      )
      .mockResolvedValue(makeAccount({ name: 'Wallet' }))
    await render()
    await fill({ 'name-field': 'Wallet', 'balance-field': '20', mask: '12' })
    await submit()
    expect(save().attributes('disabled')).toBeDefined()

    await fill({ mask: '1234' })
    expect(field('mask').text()).not.toContain('That looks wrong.')
    await submit()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('cancels, and starts afresh the next time it opens', async () => {
    const { open } = await render()
    await fill({ 'name-field': 'Wallet' })
    const cancel = dialog()
      .findAll('.app-dialog__actions button')
      .find((button) => button.text() === 'Cancel')!
    await cancel.trigger('click')
    expect(open.value).toBe(false)
    open.value = true
    await flushPromises()
    expect(value('name-field')).toBe('')
    expect(field('currency').text()).toContain('USD')
    await click('.v-overlay--active [data-test="dialog-close"]')
    expect(open.value).toBe(false)
  })

  it('edits a checking account with its balance as it is', async () => {
    await render(checking)
    expect(value('balance-field')).toBe('2,450.18')
    expect(field('balance-field').text()).toContain('Current balance')
  })
})
