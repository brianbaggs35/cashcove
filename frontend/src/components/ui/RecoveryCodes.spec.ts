import RecoveryCodes from '@/components/ui/RecoveryCodes.vue'
import { stubClipboard } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'

const codes = ['aaaa-bbbb', 'cccc-dddd']

describe('RecoveryCodes', () => {
  it('lists the codes and copies them with instructions', async () => {
    const writeText = stubClipboard()
    const { wrapper } = await mountWithPlugins(RecoveryCodes, {
      props: { codes, email: 'alex@example.com' },
    })
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(codes)
    await wrapper.find('[data-test="recovery-codes-copy"]').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="recovery-codes-copy"]').text()).toBe('Copied')
    })
    const text = writeText.mock.lastCall![0] as string
    expect(text).toContain('Account: alex@example.com')
    expect(text).toContain('aaaa-bbbb\ncccc-dddd')
  })

  it('downloads them as a text file', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:codes')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('cashcove-recovery-codes.txt')
      expect(this.href).toBe('blob:codes')
    })
    const { wrapper } = await mountWithPlugins(RecoveryCodes, {
      props: { codes, email: 'alex@example.com' },
    })
    await wrapper.find('[data-test="recovery-codes-download"]').trigger('click')
    expect(clicked).toHaveBeenCalledOnce()
    const blob = createObjectURL.mock.lastCall![0] as Blob
    expect(blob.type).toBe('text/plain')
    await expect(blob.text()).resolves.toContain('cccc-dddd')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:codes')
  })
})
