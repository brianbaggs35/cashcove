<script setup lang="ts">
import { CalendarX, PiggyBank } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import { recurringApi } from '@/api/recurring'
import type { Subscription } from '@/api/subscriptions'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useRecurringCost } from '@/composables/useRecurringCost'
import { fromIsoDate, todayIso } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import { kinds, partOf } from '@/views/subscriptions/kinds'
import SubscriptionDayChoice from '@/views/subscriptions/SubscriptionDayChoice.vue'

/**
 * Cancels a subscription or a bill, which keeps it and everything it tracked: it only stops
 * counting from the day it ends, which is when it would next have been paid unless that has gone
 * by. That is what to do instead of deleting it, which removes it, and it can be reactivated.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ subscription: Subscription | null }>()
const emit = defineEmits<{ saved: [subscription: Subscription] }>()

const { locale } = useHousehold()
const copy = computed(() => kinds[props.subscription?.kind ?? 'subscription'])
const part = (name: string) => partOf(props.subscription?.kind ?? 'subscription', name)
/** What the dialog calls it: its name, or what it is until one is chosen. */
const called = computed(() => props.subscription?.name ?? `the ${copy.value.noun}`)

const form = reactive<{ endsOn: string | null }>({ endsOn: null })
const valid = ref(false)
const today = ref(todayIso())

/** The day it would next have been paid, as long as that is after today: a service stays until what was paid for runs out. */
const nextPayment = computed(() => {
  const due = props.subscription?.next_due_date
  return due && due > today.value ? due : null
})
/** What it costs, which it stops costing once it has ended. */
const cost = useRecurringCost(() => props.subscription)

const saving = useAction(async () => {
  const subscription = props.subscription as Subscription
  const ends = form.endsOn as string
  const cancelled = await recurringApi(subscription.kind).cancel(subscription.id, {
    cancelled_on: today.value,
    ends_on: ends,
  })
  const when =
    ends > today.value ? ` It ends on ${formatShortDate(fromIsoDate(ends), locale.value)}.` : ''
  notify(`Cancelled ${subscription.name}.${when} It is kept under Cancelled`)
  emit('saved', cancelled)
  open.value = false
})
const fieldError = (field: string) => saving.fields.value[field] ?? undefined
const formError = computed(() =>
  Object.keys(saving.fields.value).length ? null : saving.error.value,
)

watch(open, (value) => {
  if (!value) return
  today.value = todayIso()
  form.endsOn = nextPayment.value ?? today.value
  saving.clear()
})
watch(form, () => {
  saving.clear()
})

function submit() {
  if (valid.value) void saving.run()
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="`Cancel ${called}?`"
    subtitle="It stays in Cashcove with all its payments, so you can look back on it, and you can reactivate it any time."
    :icon="CalendarX"
    tone="warning"
    :persistent="saving.busy.value"
    max-width="560"
    fullscreen-on-mobile
    :data-test="part('cancel-dialog')"
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <SubscriptionDayChoice
        v-model="form.endsOn"
        label="Ends on"
        hint="No payment is expected on or after this day."
        :today="today"
        :suggested="nextPayment"
        suggested-name="Next payment"
        :error="fieldError('ends_on')"
        :part="part('cancel')"
      />
      <v-alert
        v-if="cost"
        color="success"
        variant="tonal"
        density="compact"
        :icon="PiggyBank"
        class="mt-4"
        :data-test="part('cancel-saving')"
      >
        Once it ends, you stop paying {{ cost }}.
      </v-alert>
      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="formError"
        :data-test="part('cancel-error')"
      />
      <button type="submit" hidden />
    </v-form>
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">
        Keep {{ copy.noun }}
      </v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!valid"
        :data-test="part('cancel-confirm')"
        @click="submit"
      >
        Cancel {{ copy.noun }}
      </v-btn>
    </template>
  </AppDialog>
</template>
