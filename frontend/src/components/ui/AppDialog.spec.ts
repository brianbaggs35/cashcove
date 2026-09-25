import { Trash } from '@lucide/vue'
import { defineComponent, h, ref } from 'vue'

import AppDialog from '@/components/ui/AppDialog.vue'
import { page } from '@/test/dom'
import { flushPromises, mountWithPlugins } from '@/test/mount'

async function render(props: Record<string, unknown> = {}, width = 1280, withActions = true) {
  const open = ref(true)
  const Host = defineComponent({
    render: () =>
      h(
        AppDialog,
        {
          title: 'Remove passkey?',
          ...props,
          modelValue: open.value,
          'onUpdate:modelValue': (value: boolean) => (open.value = value),
        },
        {
          default: () => h('p', { class: 'dialog-body' }, 'Body'),
          ...(withActions ? { actions: () => h('button', { class: 'dialog-action' }, 'OK') } : {}),
        },
      ),
  })
  const mounted = await mountWithPlugins(Host, { width })
  await flushPromises()
  return { ...mounted, open }
}

describe('AppDialog', () => {
  it('shows the title, explanation, content and actions', async () => {
    await render({ subtitle: 'It stops working here.', icon: Trash, tone: 'error' })
    const card = page().find('.app-dialog')
    expect(card.find('h2').text()).toBe('Remove passkey?')
    expect(card.text()).toContain('It stops working here.')
    expect(card.find('.v-avatar').classes()).toContain('text-error')
    expect(card.find('.dialog-body').exists()).toBe(true)
    expect(card.find('.dialog-action').exists()).toBe(true)
  })

  it('closes from its close button', async () => {
    const { open } = await render()
    await page().find('[data-test="dialog-close"]').trigger('click')
    expect(open.value).toBe(false)
  })

  it('can leave out the icon, explanation, close button and actions', async () => {
    await render({ closable: false }, 1280, false)
    const card = page().find('.app-dialog')
    expect(card.find('.v-avatar').exists()).toBe(false)
    expect(card.find('p.text-medium-emphasis').exists()).toBe(false)
    expect(card.find('[data-test="dialog-close"]').exists()).toBe(false)
    expect(card.find('.app-dialog__actions').exists()).toBe(false)
  })

  it('cannot be closed while it is busy', async () => {
    const { open } = await render({ persistent: true })
    expect(page().find('[data-test="dialog-close"]').attributes('disabled')).toBeDefined()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(open.value).toBe(true)
  })

  it('closes with Escape', async () => {
    const { open } = await render()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('fills the screen on phones when asked to', async () => {
    await render({ fullscreenOnMobile: true }, 390)
    expect(page().find('.v-dialog').classes()).toContain('v-dialog--fullscreen')
    expect(page().find('.app-dialog').classes()).toContain('rounded-0')
  })

  it('stays a dialog on larger screens', async () => {
    await render({ fullscreenOnMobile: true }, 1280)
    expect(page().find('.v-dialog').classes()).not.toContain('v-dialog--fullscreen')
    expect(page().find('.app-dialog').classes()).toContain('rounded-xl')
  })
})
