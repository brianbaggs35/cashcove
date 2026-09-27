import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { ApiError } from '@/api/client'
import * as api from '@/api/transactions'
import { notices } from '@/composables/notify'
import { page } from '@/test/dom'
import { coffee, seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import CategorizeDialog from '@/views/transactions/CategorizeDialog.vue'

async function render(ids: string[]) {
  const open = ref(false)
  const done = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(CategorizeDialog, {
        ids,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onDone: done,
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  open.value = true
  await flushPromises()
  const picker = () => wrapper.findComponent({ name: 'CategoryPicker' })
  return { open, done, picker }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')

async function apply() {
  await dialog().find('[data-test="categorize-apply"]').trigger('click')
  await flushPromises()
}

describe('CategorizeDialog', () => {
  it('gives the selected transactions a category', async () => {
    const categorize = vi.spyOn(api, 'categorizeTransactions').mockResolvedValue({ count: 2 })
    const { open, done, picker } = await render(['a', 'b'])
    expect(dialog().find('h2').text()).toBe('Categorize 2 transactions')

    picker().vm.$emit('update:modelValue', coffee.id)
    await apply()

    expect(categorize).toHaveBeenCalledWith(['a', 'b'], coffee.id)
    expect(notices.value.at(-1)?.text).toBe('Categorized 2 transactions')
    expect(done).toHaveBeenCalled()
    expect(open.value).toBe(false)
  })

  it('takes the category away when none is chosen', async () => {
    vi.spyOn(api, 'categorizeTransactions').mockResolvedValue({ count: 1 })
    await render(['a'])
    expect(dialog().find('h2').text()).toBe('Categorize 1 transaction')
    await apply()
    expect(notices.value.at(-1)?.text).toBe('1 transaction now uncategorized')
  })

  it('says what went wrong and starts afresh when opened again', async () => {
    vi.spyOn(api, 'categorizeTransactions').mockRejectedValue(
      new ApiError(404, 'That category no longer exists.'),
    )
    const { open, done, picker } = await render(['a'])
    picker().vm.$emit('update:modelValue', coffee.id)
    await apply()
    expect(dialog().find('[data-test="categorize-error"]').text()).toBe(
      'That category no longer exists.',
    )
    expect(done).not.toHaveBeenCalled()

    await dialog()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()
    open.value = true
    await flushPromises()
    expect(dialog().find('[data-test="categorize-error"]').exists()).toBe(false)
    expect(picker().props('modelValue')).toBeNull()
  })
})
