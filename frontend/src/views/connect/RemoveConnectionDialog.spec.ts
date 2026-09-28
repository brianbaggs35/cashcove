import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { ApiError } from '@/api/client'
import * as api from '@/api/connections'
import type { Connection } from '@/api/connections'
import { notices } from '@/composables/notify'
import { useConnectionsStore } from '@/stores/connections'
import { makeConnection, makeShared, sharedSavings, tartan } from '@/test/connections'
import { page } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'
import RemoveConnectionDialog from '@/views/connect/RemoveConnectionDialog.vue'

async function render(connection: Connection | null = tartan) {
  const open = ref(false)
  const Host = defineComponent({
    render: () =>
      h(RemoveConnectionDialog, {
        connection,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => (useConnectionsStore().connections = connection ? [connection] : []),
  })
  open.value = true
  await flushPromises()
  return { open }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)

async function confirm() {
  await find('remove-connection-confirm').trigger('click')
  await flushPromises()
}

describe('RemoveConnectionDialog', () => {
  it('removes the bank and keeps its accounts', async () => {
    const remove = vi.spyOn(api, 'deleteConnection').mockResolvedValue(undefined)
    const { open } = await render()

    expect(dialog().find('h2').text()).toBe('Remove Tartan Bank?')
    expect(dialog().text()).toContain('Its imported account:')
    expect(find('remove-connection-confirm').text()).toBe('Remove Tartan Bank')
    await confirm()

    expect(remove).toHaveBeenCalledWith(tartan.id, true)
    expect(useConnectionsStore().connections).toEqual([])
    expect(notices.value.at(-1)?.text).toBe('Removed Tartan Bank')
    expect(open.value).toBe(false)
  })

  it('can delete the accounts along with it', async () => {
    const remove = vi.spyOn(api, 'deleteConnection').mockResolvedValue(undefined)
    const connection = makeConnection({
      accounts: [makeShared(), makeShared({ id: 'plaid-2', account_id: 'account-2' })],
    })
    await render(connection)
    expect(dialog().text()).toContain('Its 2 imported accounts:')
    await find('remove-connection-delete').find('input').trigger('click')
    await confirm()
    expect(remove).toHaveBeenCalledWith(connection.id, false)
  })

  it('says nothing else changes when nothing was imported', async () => {
    await render(makeConnection({ accounts: [sharedSavings] }))
    expect(dialog().text()).toContain('Nothing was imported from it')
    expect(find('remove-connection-keep').exists()).toBe(false)
  })

  it('stays open with the error when removing fails, and starts fresh next time', async () => {
    vi.spyOn(api, 'deleteConnection').mockRejectedValue(
      new ApiError(502, 'Plaid couldn’t remove the connection.'),
    )
    const { open } = await render()
    await find('remove-connection-delete').find('input').trigger('click')
    await confirm()
    expect(find('remove-connection-error').text()).toBe('Plaid couldn’t remove the connection.')

    await dialog().find('.v-card-actions button').trigger('click')
    expect(open.value).toBe(false)
    open.value = true
    await flushPromises()
    expect(find('remove-connection-error').exists()).toBe(false)
    expect((find('remove-connection-keep').find('input').element as HTMLInputElement).checked).toBe(
      true,
    )
  })

  it('names the bank generically until there is one', async () => {
    await render(null)
    expect(dialog().find('h2').text()).toBe('Remove the bank?')
  })
})
