import { Trash } from '@lucide/vue'

import ConfirmDialogHost from '@/components/ui/ConfirmDialogHost.vue'
import { confirm } from '@/composables/confirm'
import { click, page } from '@/test/dom'
import { flushPromises, mountWithPlugins } from '@/test/mount'

async function render() {
  const mounted = await mountWithPlugins(ConfirmDialogHost)
  await flushPromises()
  return mounted
}

describe('ConfirmDialogHost', () => {
  it('asks a plain question with default buttons', async () => {
    await render()
    const answer = confirm({ title: 'Continue?' })
    await flushPromises()
    expect(page().find('.app-dialog h2').text()).toBe('Continue?')
    expect(page().find('[data-test="confirm-text"]').exists()).toBe(false)
    expect(page().find('[data-test="confirm-cancel"]').text()).toBe('Cancel')
    expect(page().find('[data-test="confirm-accept"]').text()).toBe('Confirm')
    expect(page().find('.app-dialog .v-avatar').classes()).toContain('text-primary')
    await click('[data-test="confirm-accept"]')
    await expect(answer).resolves.toBe(true)
  })

  it('says what it will do, in the tone of the change', async () => {
    await render()
    const answer = confirm({
      title: 'Remove passkey?',
      text: 'It stops working.',
      confirmText: 'Remove passkey',
      cancelText: 'Keep it',
      tone: 'error',
    })
    await flushPromises()
    expect(page().find('[data-test="confirm-text"]').text()).toBe('It stops working.')
    expect(page().find('[data-test="confirm-accept"]').text()).toBe('Remove passkey')
    expect(page().find('[data-test="confirm-accept"]').classes()).toContain('bg-error')
    expect(page().find('.app-dialog .v-avatar').classes()).toContain('text-error')
    await click('[data-test="confirm-cancel"]')
    await expect(answer).resolves.toBe(false)
  })

  it('uses the icon it is given', async () => {
    await render()
    void confirm({ title: 'Delete?', icon: Trash, tone: 'warning' })
    await flushPromises()
    expect(page().find('.app-dialog .v-avatar').classes()).toContain('text-warning')
    expect(page().find('.app-dialog .v-avatar .lucide-trash').exists()).toBe(true)
  })

  it('treats closing the dialog as cancelling', async () => {
    await render()
    const answer = confirm({ title: 'Continue?' })
    await flushPromises()
    await click('[data-test="dialog-close"]')
    await expect(answer).resolves.toBe(false)
  })

  it('runs the action, staying open with the error if it fails', async () => {
    await render()
    const action = vi.fn().mockRejectedValueOnce(new Error('Offline.')).mockResolvedValue(undefined)
    const answer = confirm({ title: 'Sign out?', action })
    await flushPromises()
    await click('[data-test="confirm-accept"]')
    await flushPromises()
    expect(page().find('[data-test="confirm-error"]').text()).toBe('Offline.')
    await click('[data-test="confirm-accept"]')
    await expect(answer).resolves.toBe(true)
    expect(action).toHaveBeenCalledTimes(2)
  })
})
