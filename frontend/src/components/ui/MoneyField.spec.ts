import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import MoneyField from '@/components/ui/MoneyField.vue'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'

async function render(initial: string | null, props: Record<string, unknown> = {}) {
  const amount = ref<string | null>(initial)
  const Host = defineComponent({
    render: () =>
      h(MoneyField, {
        label: 'Amount',
        ...props,
        modelValue: amount.value,
        'onUpdate:modelValue': (value: string | null) => (amount.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    beforeMount: () => {
      const { preferences } = seedFinance()
      if (props.locale) preferences.saved!.general.locale = props.locale as string
    },
  })
  const input = wrapper.find('input')
  async function type(text: string) {
    await input.setValue(text)
    await flushPromises()
  }
  return { wrapper, amount, input, type }
}

describe('MoneyField', () => {
  it('shows the amount in the household number format with its currency', async () => {
    const { wrapper, input } = await render('1234.5')
    expect((input.element as HTMLInputElement).value).toBe('1,234.50')
    expect(wrapper.find('.v-text-field__prefix').text()).toBe('$')
    expect(input.attributes('inputmode')).toBe('decimal')
  })

  it('turns what is typed into an amount, and tidies it up afterwards', async () => {
    const { amount, input, type } = await render(null, { currency: 'EUR' })
    expect((input.element as HTMLInputElement).value).toBe('')

    await type('42,5')
    expect(amount.value).toBe('42.50')
    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('42.50')

    await type('4 2')
    expect(amount.value).toBe('42.00')
    await type('nonsense')
    expect(amount.value).toBeNull()
    // Nothing to tidy while it isn't an amount.
    await input.trigger('blur')
    expect((input.element as HTMLInputElement).value).toBe('nonsense')
  })

  it('reads amounts the way the household writes them', async () => {
    const { amount, input, type } = await render('1234.5', { locale: 'de-DE' })
    expect((input.element as HTMLInputElement).value).toBe('1.234,50')
    await type('1.500')
    expect(amount.value).toBe('1500.00')
  })

  it('follows changes from outside', async () => {
    const { amount, input } = await render('10.00')
    amount.value = '25.5'
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('25.50')
    amount.value = null
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('explains what it needs', async () => {
    const { wrapper, type } = await render(null, {
      required: true,
      nonZero: true,
      label: 'Balance',
    })
    const messages = () => wrapper.find('.v-messages').text()

    await type('x')
    expect(messages()).toBe('Enter an amount like 42.50')
    await type('-5')
    expect(messages()).toBe('Enter the amount without a minus sign')
    await type('0')
    expect(messages()).toBe('Enter an amount other than zero')
    await type('')
    expect(messages()).toBe('Enter the balance')
    await type('12')
    expect(messages()).toBe('')
  })

  it('can take negative amounts and leave the field empty', async () => {
    const { wrapper, amount, type } = await render(null, { allowNegative: true })
    await type('-5')
    expect(amount.value).toBe('-5.00')
    expect(wrapper.find('.v-messages').text()).toBe('')
    await type('')
    expect(amount.value).toBeNull()
    expect(wrapper.find('.v-messages').text()).toBe('')
  })
})
