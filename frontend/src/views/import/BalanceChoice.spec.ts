import { flushPromises } from '@vue/test-utils'

import type { ImportPreview } from '@/api/imports'
import { useImportWizard } from '@/stores/importWizard'
import { checking, makeAccount, seedFinance } from '@/test/finance'
import { makePreview, makeRow, seedWizard } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import BalanceChoice from '@/views/import/BalanceChoice.vue'

const storeCard = makeAccount({
  id: 'account-store-card',
  name: 'Maple store card',
  type: 'credit_card',
  institution: null,
  balance: '-512.40',
})

async function render(preview: ImportPreview = makePreview()) {
  const { wrapper } = await mountWithPlugins(BalanceChoice, {
    width: 1280,
    beforeMount: () => {
      seedFinance({ accounts: [checking, storeCard] })
      seedWizard(preview, 'review')
    },
  })
  /** Each choice as "title · what it does · the balance after", and whether it's suggested or chosen. */
  const options = () =>
    wrapper.findAll('.balance-choice__option').map((option) => ({
      text: [
        option.find('.text-body-large').element.firstChild?.textContent?.trim(),
        option.find('span.d-block.text-body-small').text(),
        `${option.find('.text-end .text-body-large').text()} ${option.find('.text-label-small').text()}`,
      ].join(' · '),
      suggested: option.find('[data-test="balance-suggested"]').exists(),
      chosen: option.classes().includes('balance-choice__option--chosen'),
    }))
  return { wrapper, options, wizard: useImportWizard() }
}

describe('BalanceChoice', () => {
  it('offers the file’s balance, adding what’s imported, or leaving it', async () => {
    const { wrapper, options, wizard } = await render()
    expect(wrapper.find('legend').text()).toBe('Everyday checking’s balance')
    expect(wrapper.find('p').text()).toBe('It’s $2,450.18 now.')
    expect(options()).toEqual([
      {
        text: 'Use the file’s balance · What the file says it was on Sep 3 · $2,781.88 after',
        suggested: true,
        chosen: true,
      },
      {
        text: 'Add what’s imported · Moves it by +$1,875.00, as adding them by hand would · $4,325.18 after',
        suggested: false,
        chosen: false,
      },
      {
        text: 'Leave it as it is · For history the balance already counts · $2,450.18 after',
        suggested: false,
        chosen: false,
      },
    ])

    await wrapper.find('[data-test="balance-keep"] input').setValue(true)
    await flushPromises()
    expect(wizard.balance).toBe('keep')
    expect(options().map((option) => option.chosen)).toEqual([false, false, true])
  })

  it('shows what’s owed on a card, and leaves out a balance the file doesn’t have', async () => {
    const { wrapper, options } = await render(
      makePreview({
        account_id: storeCard.id,
        rows: [makeRow({ amount: '-87.60', payee: 'Maple Home' })],
        balance: { current: '-512.40', closing: null, closing_date: null, suggested: 'move' },
      }),
    )
    expect(wrapper.find('p').text()).toBe('It’s $512.40 owed now.')
    expect(options()).toEqual([
      {
        text: 'Add what’s imported · Moves it by -$87.60, as adding them by hand would · $600.00 owed after',
        suggested: true,
        chosen: true,
      },
      {
        text: 'Leave it as it is · For history the balance already counts · $512.40 owed after',
        suggested: false,
        chosen: false,
      },
    ])
  })

  it('says what the file’s balance was, even without its day', async () => {
    const { options } = await render(
      makePreview({
        balance: { current: '2450.18', closing: '2600.00', closing_date: null, suggested: 'keep' },
      }),
    )
    expect(options()[0]!.text).toBe(
      'Use the file’s balance · What the file says it was · $2,600.00 after',
    )
    expect(options().map((option) => option.suggested)).toEqual([false, false, true])
  })
})
