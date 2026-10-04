<script setup lang="ts">
import { Repeat } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { linkSubscriptionPayments } from '@/api/subscriptions'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { expectedAmount, frequencyTitle } from '@/views/subscriptions/recurrence'

/**
 * Links the selected payments to a subscription by hand, e.g. when an automation got one wrong
 * or a bill didn't have the payee it usually does. They take its category and settle its due date.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  /** The money going out among the selected transactions, which a subscription can have. */
  ids: string[]
  /** How many were selected in all, so the dialog can say when some can't be linked. */
  selected: number
}>()
const emit = defineEmits<{ done: [] }>()

const subscriptions = useSubscriptionsStore()
const accounts = useAccountsStore()
const { money } = useHousehold()

const subscriptionId = ref<string | null>(null)
const items = computed(() =>
  subscriptions.active.map((item) => ({
    value: item.id,
    title: item.name,
    props: {
      subtitle: `${frequencyTitle(item.frequency)} · ${money(expectedAmount(item), accounts.find(item.account_id)?.currency)}`,
    },
  })),
)
const skipped = computed(() => props.selected - props.ids.length)

watch(open, (value) => {
  if (!value) return
  subscriptionId.value = null
  saving.clear()
  void subscriptions.load()
})

const saving = useAction(async () => {
  const id = subscriptionId.value as string
  const { count } = await linkSubscriptionPayments(id, props.ids)
  const name = subscriptions.find(id)?.name ?? 'the subscription'
  const what = props.ids.length === 1 ? '1 payment' : `${props.ids.length} payments`
  notify(count ? `Linked ${what} to ${name}` : `${what} already linked to ${name}`)
  emit('done')
  open.value = false
})
</script>

<template>
  <AppDialog
    v-model="open"
    :title="
      ids.length === 1
        ? 'Link 1 payment to a subscription'
        : `Link ${ids.length} payments to a subscription`
    "
    subtitle="They count toward the subscription, take its category and settle its next due date."
    :icon="Repeat"
    :persistent="saving.busy.value"
  >
    <v-select
      v-model="subscriptionId"
      :items="items"
      label="Subscription"
      no-data-text="Add a subscription in the Subscriptions tab first"
      data-test="link-subscription"
    />
    <v-alert
      v-if="skipped > 0"
      type="info"
      variant="tonal"
      density="compact"
      class="mt-2"
      data-test="link-skipped"
    >
      {{ skipped === 1 ? '1 selected transaction is' : `${skipped} selected transactions are` }}
      money coming in, which isn't a payment, so
      {{ skipped === 1 ? 'it stays' : 'they stay' }} as {{ skipped === 1 ? 'it is' : 'they are' }}.
    </v-alert>
    <v-alert
      v-if="saving.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-2"
      :text="saving.error.value"
      data-test="link-error"
    />
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!subscriptionId"
        data-test="link-apply"
        @click="saving.run()"
      >
        Link
      </v-btn>
    </template>
  </AppDialog>
</template>
