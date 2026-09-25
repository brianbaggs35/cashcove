import { flushPromises } from '@vue/test-utils'
import { KeyRound } from '@lucide/vue'
import { defineComponent, h, ref } from 'vue'

import { click, page } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'
import { formatDateTime } from '@/utils/format'
import LinkDialog from '@/views/settings/users/LinkDialog.vue'

async function render(props: Record<string, unknown> = {}) {
  const open = ref(true)
  const Host = defineComponent({
    render: () =>
      h(LinkDialog, {
        title: 'Password reset link for Sam Lee',
        text: 'Send this link to Sam Lee.',
        link: 'https://cashcove.example.com/reset-password#token',
        expiresAt: '2026-09-26T12:00:00Z',
        ...props,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  await mountWithPlugins(Host)
  await flushPromises()
  return { open }
}

describe('LinkDialog', () => {
  it('shows the one-time link to copy, and when it expires', async () => {
    const { open } = await render()
    const dialog = page().find('.v-overlay--active .app-dialog')
    expect(dialog.find('h2').text()).toBe('Password reset link for Sam Lee')
    expect(dialog.text()).toContain('Send this link to Sam Lee.')
    expect(dialog.find('[data-test="one-time-link-value"]').text()).toBe(
      'https://cashcove.example.com/reset-password#token',
    )
    expect(dialog.text()).toContain(formatDateTime('2026-09-26T12:00:00Z'))
    expect(dialog.find('.lucide-link-2').exists()).toBe(true)
    await click('[data-test="link-done"]')
    expect(open.value).toBe(false)
  })

  it('closes from the close button too', async () => {
    const { open } = await render()
    await click('.v-overlay--active [data-test="dialog-close"]')
    expect(open.value).toBe(false)
  })

  it('takes an icon', async () => {
    await render({ icon: KeyRound })
    expect(page().find('.v-overlay--active .lucide-key-round').exists()).toBe(true)
  })
})
