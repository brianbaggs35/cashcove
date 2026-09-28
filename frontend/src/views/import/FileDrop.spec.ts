import type { DOMWrapper } from '@vue/test-utils'

import { mountWithPlugins } from '@/test/mount'
import FileDrop from '@/views/import/FileDrop.vue'

const file = new File(['Date,Amount\n'], 'checking.csv', { type: 'text/csv' })

async function render() {
  const { wrapper } = await mountWithPlugins(FileDrop)
  const drop = wrapper.find('[data-test="file-drop"]')
  const title = () => wrapper.find('[data-test="file-drop-title"]').text()
  const drag = (type: string, types: string[] = ['Files'], files: File[] = [file]) =>
    drop.trigger(type, { dataTransfer: { types, files } })
  return { wrapper, drop, title, drag }
}

function choose(input: DOMWrapper<Element>, files: File[]) {
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  return input.trigger('change')
}

describe('FileDrop', () => {
  it('names the formats it takes', async () => {
    const { wrapper, title } = await render()
    expect(title()).toBe('Import a statement file')
    expect(wrapper.findAll('.v-chip').map((chip) => chip.text())).toEqual([
      'CSV',
      'OFX',
      'QFX',
      'QBO',
      'QIF',
    ])
    expect(wrapper.find('[data-test="file-input"]').attributes('accept')).toBe(
      '.csv,.tsv,.txt,.ofx,.qfx,.qbo,.qif',
    )
  })

  it('opens the file picker, from its button or when asked', async () => {
    const { wrapper } = await render()
    const picker = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await wrapper.find('[data-test="file-choose"]').trigger('click')
    ;(wrapper.vm as unknown as { choose: () => void }).choose()
    expect(picker).toHaveBeenCalledTimes(2)
  })

  it('hands on a chosen file, and lets the same one be chosen again', async () => {
    const { wrapper } = await render()
    const input = wrapper.find('[data-test="file-input"]')
    await choose(input, [file])
    await choose(input, [])
    expect(wrapper.emitted('file')).toEqual([[file]])
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('takes a file dropped on it', async () => {
    const { wrapper, drop, title, drag } = await render()

    await drag('dragenter')
    expect(title()).toBe('Drop it to import it')
    expect(drop.classes()).toContain('file-drop--over')
    // Crossing from one of its parts to another.
    await drag('dragenter')
    await drag('dragleave')
    expect(title()).toBe('Drop it to import it')
    await drag('dragleave')
    await drag('dragleave')
    expect(title()).toBe('Import a statement file')

    await drag('dragenter')
    await drag('drop')
    expect(title()).toBe('Import a statement file')
    await drag('drop', ['Files'], [])
    expect(wrapper.emitted('file')).toEqual([[file]])
  })

  it('ignores dragging anything but files', async () => {
    const { drop, title, drag } = await render()
    await drag('dragenter', ['text/plain'])
    await drop.trigger('dragenter')
    expect(title()).toBe('Import a statement file')
  })

  it('lets files be dropped on it', async () => {
    const { drop } = await render()
    const over = new Event('dragover', { cancelable: true })
    drop.element.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
  })

  it('says where to get statement files', async () => {
    const { wrapper } = await render()
    const toggle = wrapper.find('[data-test="file-help-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-test="file-help"]').text()).toContain(
      'PDF statements can’t be read.',
    )
  })
})
