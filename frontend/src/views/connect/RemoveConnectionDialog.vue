<script setup lang="ts">
import { Unplug } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { deleteConnection, type Connection } from '@/api/connections'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useConnectionsStore } from '@/stores/connections'

/**
 * Disconnects a bank, at Plaid too. Its imported accounts stay, with their history, as accounts
 * kept by hand, unless they're deleted along with it.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ connection: Connection | null }>()

const store = useConnectionsStore()
const keep = ref(true)

const bank = computed(() => props.connection?.institution_name ?? 'the bank')
const imported = computed(
  () => props.connection?.accounts.filter((account) => account.state === 'imported').length ?? 0,
)

const removing = useAction(async () => {
  const connection = props.connection as Connection
  await deleteConnection(connection.id, keep.value)
  store.remove(connection.id)
  notify(`Removed ${connection.institution_name}`)
  open.value = false
})

watch(open, (value) => {
  if (!value) return
  keep.value = true
  removing.clear()
})
</script>

<template>
  <AppDialog
    v-model="open"
    :title="`Remove ${bank}?`"
    subtitle="Cashcove stops syncing it, and Plaid stops sharing its data."
    :icon="Unplug"
    tone="error"
    :persistent="removing.busy.value"
  >
    <v-alert
      v-if="removing.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="removing.error.value"
      data-test="remove-connection-error"
    />
    <template v-if="imported">
      <p class="text-body-medium mb-2">
        {{ imported === 1 ? 'Its imported account' : `Its ${imported} imported accounts` }}:
      </p>
      <v-radio-group v-model="keep" hide-details :disabled="removing.busy.value">
        <v-radio :value="true" data-test="remove-connection-keep">
          <template #label>
            <div>
              <div class="text-body-large">Keep them</div>
              <div class="text-body-small text-medium-emphasis">
                With all their transactions, as accounts you update by hand.
              </div>
            </div>
          </template>
        </v-radio>
        <v-radio :value="false" color="error" class="mt-2" data-test="remove-connection-delete">
          <template #label>
            <div>
              <div class="text-body-large">Delete them</div>
              <div class="text-body-small text-medium-emphasis">
                Along with their transactions, for good.
              </div>
            </div>
          </template>
        </v-radio>
      </v-radio-group>
    </template>
    <p v-else class="text-body-medium mb-0">
      Nothing was imported from it, so nothing else changes.
    </p>

    <template #actions>
      <v-btn variant="text" :disabled="removing.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="error"
        variant="flat"
        :loading="removing.busy.value"
        data-test="remove-connection-confirm"
        @click="removing.run()"
      >
        Remove {{ bank }}
      </v-btn>
    </template>
  </AppDialog>
</template>
