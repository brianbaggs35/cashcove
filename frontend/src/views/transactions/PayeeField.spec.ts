import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as api from '@/api/transactions'
import { page } from '@/test/dom'
import { groceries } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import PayeeField from '@/views/transactions/PayeeField.vue'

const suggestions: api.PayeeSuggestion[] = [
  { payee: 'Whole Foods', category_id: groceries.id, count: 12 },
  { payee: 'Wholesale Club', category_id: null, count: 2 },
]

async function render(initial = '') {
  const payee = ref(initial)
  const picked = vi.fn()
  const Host = defineComponent({
    render: () =>
      h('form', [
        h(PayeeField, {
          modelValue: payee.value,
          'onUpdate:modelValue': (value: string) => (payee.value = value),
          onPicked: picked,
        }),
      ]),
  })
  const { wrapper } = await mountWithPlugins(Host, { width: 1280 })
  // The first input only carries the value for the form.
  const input = wrapper.find('input:not([type="hidden"])')
  const combobox = wrapper.findComponent({ name: 'VCombobox' })
  return { wrapper, payee, picked, input, combobox }
}

const options = () =>
  page()
    .findAll('.v-overlay--active .v-list-item')
    .map((item) => item.text())

describe('PayeeField', () => {
  it('suggests payees used before as soon as it has focus', async () => {
    const fetch = vi.spyOn(api, 'fetchPayees').mockResolvedValue(suggestions)
    const { input } = await render('Who')
    await input.trigger('focus')
    await flushPromises()
    expect(fetch).toHaveBeenCalledWith('Who')
  })

  it('suggests payees matching what is typed, once typing pauses', async () => {
    const fetch = vi.spyOn(api, 'fetchPayees').mockResolvedValue(suggestions)
    const { combobox } = await render()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    combobox.vm.$emit('update:search', 'Who')
    combobox.vm.$emit('update:search', 'Whol')
    vi.advanceTimersByTime(200)
    combobox.vm.$emit('update:search', null)
    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    await flushPromises()

    expect(fetch.mock.calls).toEqual([['Whol'], ['']])
  })

  it('fills in a payee picked from the suggestions and passes it on', async () => {
    vi.spyOn(api, 'fetchPayees').mockResolvedValue(suggestions)
    const { wrapper, input, payee, picked } = await render()
    await input.trigger('focus')
    await flushPromises()
    await wrapper.find('.v-field').trigger('mousedown')
    await flushPromises()
    expect(options()).toEqual(['Whole Foods', 'Wholesale Club'])

    await page().findAll('.v-overlay--active .v-list-item')[0]!.trigger('click')
    await flushPromises()
    expect(payee.value).toBe('Whole Foods')
    expect(picked).toHaveBeenCalledWith(suggestions[0])
  })

  it('takes any payee typed, even one never used', async () => {
    vi.spyOn(api, 'fetchPayees').mockResolvedValue([])
    const { combobox, payee, picked } = await render('Whole Foods')
    combobox.vm.$emit('update:modelValue', 'Farmers market')
    expect(payee.value).toBe('Farmers market')
    combobox.vm.$emit('update:modelValue', null)
    expect(payee.value).toBe('')
    expect(picked).not.toHaveBeenCalled()
  })

  it('keeps only the suggestions for the latest text', async () => {
    let answerFirst!: (value: api.PayeeSuggestion[]) => void
    vi.spyOn(api, 'fetchPayees')
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce([suggestions[1]!])
    const { wrapper, input } = await render()
    const element = input.element as HTMLInputElement
    element.focus()
    element.blur()
    element.focus()
    await flushPromises()
    answerFirst(suggestions)
    await flushPromises()

    await wrapper.find('.v-field').trigger('mousedown')
    await flushPromises()
    expect(options()).toEqual(['Wholesale Club'])
  })

  it('works without suggestions when they fail to load', async () => {
    vi.spyOn(api, 'fetchPayees').mockRejectedValue(new Error('offline'))
    const { input, payee } = await render()
    await input.trigger('focus')
    await input.setValue('Farmers market')
    await flushPromises()
    expect(payee.value).toBe('Farmers market')
  })

  it('keeps its label inside the field until there is a payee', async () => {
    vi.spyOn(api, 'fetchPayees').mockResolvedValue([])
    const { wrapper, combobox } = await render()
    expect(wrapper.find('.v-field--dirty').exists()).toBe(false)
    combobox.vm.$emit('update:modelValue', 'Farmers market')
    await flushPromises()
    expect(wrapper.find('.v-field--dirty').exists()).toBe(true)
  })

  it('asks for a payee when there is none', async () => {
    vi.spyOn(api, 'fetchPayees').mockResolvedValue([])
    const { wrapper, combobox } = await render()
    await combobox.vm.validate()
    await flushPromises()
    expect(wrapper.text()).toContain('Enter who it was paid to or received from')
  })

  it('asks for a payee of a sensible length', async () => {
    vi.spyOn(api, 'fetchPayees').mockResolvedValue([])
    const { wrapper, combobox } = await render('x')
    combobox.vm.$emit('update:modelValue', '  ')
    await flushPromises()
    expect(wrapper.text()).toContain('Enter who it was paid to or received from')
    combobox.vm.$emit('update:modelValue', 'x'.repeat(161))
    await flushPromises()
    expect(wrapper.text()).toContain('Keep it under 160 characters')
  })
})
