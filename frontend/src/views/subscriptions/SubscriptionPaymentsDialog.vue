<script setup lang="ts">
import { Link2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { errorMessage } from '@/api/client'
import { recurringApi } from '@/api/recurring'
import type { Subscription } from '@/api/subscriptions'
import type { Transaction } from '@/api/transactions'
import TransactionFinder from '@/components/finance/TransactionFinder.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useHousehold } from '@/composables/useHousehold'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import { kinds } from '@/views/subscriptions/kinds'

/**
 * Links payments, from any account, to a subscription or a bill and takes them off again. Linked
 * payments count toward it, take its category and settle its next due date.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ subscription: Subscription | null }>()
const emit = defineEmits<{ changed: [subscription: Subscription] }>()

const subscriptions = useSubscriptionsStore()
const { locale } = useHousehold()

const current = ref<Subscription | null>(props.subscription)
const copy = computed(() => kinds[props.subscription?.kind ?? 'subscription'])
const scope = ref<'all' | 'linked'>('all')
/** Counts openings, so each starts with a fresh list. */
const openings = ref(0)
const busy = ref<string | null>(null)
/** The finder's `reload`, to list payments afresh after one changed. */
const finder = ref<{ reload: () => Promise<void> } | null>(null)

watch(
  () => props.subscription,
  (subscription) => {
    current.value = subscription
  },
)
watch(open, (value) => {
  if (!value) return
  openings.value++
  scope.value = 'all'
  current.value = props.subscription
  // Names the other subscriptions payments are linked to.
  void subscriptions.load()
})

function summaryOf(subscription: Subscription): string {
  const count = subscription.payment_count
  const linked = `${count} ${count === 1 ? 'payment' : 'payments'} linked.`
  const due = formatShortDate(fromIsoDate(subscription.next_due_date), locale.value)
  return `${linked} Next payment due ${due}.`
}

/** Where a payment linked to another subscription or bill says so. */
function linkedElsewhere(transaction: Transaction): string | null {
  if (!transaction.subscription_id || transaction.subscription_id === current.value?.id) return null
  return `Linked to ${subscriptions.find(transaction.subscription_id)?.name ?? 'another subscription or bill'}`
}

async function toggle(transaction: Transaction) {
  const subscription = current.value
  if (!subscription) return
  const linked = transaction.subscription_id === subscription.id
  const api = recurringApi(subscription.kind)
  busy.value = transaction.id
  try {
    if (linked) {
      current.value = await api.unlink(subscription.id, transaction.id)
      notify(`Unlinked ${transaction.payee} from ${subscription.name}`)
    } else {
      current.value = (await api.link(subscription.id, [transaction.id])).subscription
      notify(`Linked ${transaction.payee} to ${subscription.name}`)
    }
    emit('changed', current.value)
    await finder.value?.reload()
  } catch (linkError) {
    notify(`Couldn't update the payment. ${errorMessage(linkError)}`, 'error')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="`Link payments to ${subscription?.name ?? `a ${copy.noun}`}`"
    :subtitle="`Choose payments from any account. Linked payments count toward the ${copy.noun}, take its category and settle its next due date.`"
    :icon="Link2"
    max-width="680"
    fullscreen-on-mobile
    :data-test="`${copy.noun}-payments-dialog`"
  >
    <template v-if="current">
      <div class="d-flex flex-wrap align-center justify-space-between ga-3 mb-3">
        <p class="text-body-medium ma-0" data-test="payments-summary">
          {{ summaryOf(current) }}
        </p>
        <v-btn-toggle
          v-model="scope"
          mandatory
          divided
          variant="outlined"
          color="primary"
          density="comfortable"
          aria-label="Which payments to list"
          data-test="payments-scope"
        >
          <v-btn value="all">All payments</v-btn>
          <v-btn value="linked">Linked here</v-btn>
        </v-btn-toggle>
      </div>
      <TransactionFinder
        :key="openings"
        ref="finder"
        direction="out"
        :subscription-id="scope === 'linked' ? current.id : null"
        :note="linkedElsewhere"
      >
        <template #append="{ transaction }">
          <v-btn
            v-if="transaction.subscription_id === current.id"
            variant="tonal"
            size="small"
            :loading="busy === transaction.id"
            :aria-label="`Unlink ${transaction.payee}`"
            :data-test="`payment-unlink-${transaction.id}`"
            @click="toggle(transaction)"
          >
            Linked
          </v-btn>
          <v-btn
            v-else
            variant="tonal"
            color="primary"
            size="small"
            :loading="busy === transaction.id"
            :aria-label="`${transaction.subscription_id ? 'Move' : 'Link'} ${transaction.payee} to ${current.name}`"
            :data-test="`payment-link-${transaction.id}`"
            @click="toggle(transaction)"
          >
            {{ transaction.subscription_id ? 'Move here' : 'Link' }}
          </v-btn>
        </template>
      </TransactionFinder>
    </template>
    <template #actions>
      <v-btn variant="text" data-test="payments-done" @click="open = false">Done</v-btn>
    </template>
  </AppDialog>
</template>
