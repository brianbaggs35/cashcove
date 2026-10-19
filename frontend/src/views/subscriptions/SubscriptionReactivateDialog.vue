<script setup lang="ts">
import { RotateCcw, Wallet } from '@lucide/vue'
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
import { nextOnSchedule } from '@/views/subscriptions/recurrence'
import SubscriptionDayChoice from '@/views/subscriptions/SubscriptionDayChoice.vue'

/**
 * Reactivates a subscription or a bill that was cancelled or has ended, so that it carries on
 * like any regular one: it has no end date, its payments are matched again and it counts toward
 * what is paid. Its next payment starts on the day it would fall due by its old schedule, so it
 * doesn't come back already late, and can be any other day.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ subscription: Subscription | null }>()
const emit = defineEmits<{ saved: [subscription: Subscription] }>()

const { locale } = useHousehold()
const copy = computed(() => kinds[props.subscription?.kind ?? 'subscription'])
const part = (name: string) => partOf(props.subscription?.kind ?? 'subscription', name)
/** What the dialog calls it: its name, or what it is until one is chosen. */
const called = computed(() => props.subscription?.name ?? `the ${copy.value.noun}`)

const form = reactive<{ nextDue: string | null }>({ nextDue: null })
const valid = ref(false)
const today = ref(todayIso())

/** Where its old schedule next falls due, which is the day it carries on from by default. */
const onSchedule = computed(() =>
  props.subscription ? nextOnSchedule(props.subscription, today.value) : today.value,
)
/** What it will cost again, which the dialog says so it is no surprise. */
const cost = useRecurringCost(() => props.subscription)

const saving = useAction(async () => {
  const subscription = props.subscription as Subscription
  const next = form.nextDue as string
  const reactivated = await recurringApi(subscription.kind).reactivate(subscription.id, {
    next_due_date: next,
    today: today.value,
  })
  const when = formatShortDate(fromIsoDate(next), locale.value)
  notify(`Reactivated ${subscription.name}. Its next payment is ${when}`)
  emit('saved', reactivated)
  open.value = false
})
const fieldError = (field: string) => saving.fields.value[field] ?? undefined
const formError = computed(() =>
  Object.keys(saving.fields.value).length ? null : saving.error.value,
)

watch(open, (value) => {
  if (!value) return
  today.value = todayIso()
  form.nextDue = onSchedule.value
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
    :title="`Reactivate ${called}?`"
    :subtitle="`It picks up again as a regular ${copy.noun}: payments are matched, reminders are sent and it counts toward what you pay.`"
    :icon="RotateCcw"
    :persistent="saving.busy.value"
    max-width="560"
    fullscreen-on-mobile
    :data-test="part('reactivate-dialog')"
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <SubscriptionDayChoice
        v-model="form.nextDue"
        :label="copy.dueLabel"
        hint="When is it next due? Reminders and due dates count from this day."
        :today="today"
        :suggested="onSchedule === today ? null : onSchedule"
        suggested-name="On its schedule"
        :error="fieldError('next_due_date')"
        :part="part('reactivate')"
      />
      <v-alert
        v-if="cost"
        color="info"
        variant="tonal"
        density="compact"
        :icon="Wallet"
        class="mt-4"
        :data-test="part('reactivate-cost')"
      >
        It counts toward what you pay again: {{ cost }}.
      </v-alert>
      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="formError"
        :data-test="part('reactivate-error')"
      />
      <button type="submit" hidden />
    </v-form>
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Not now</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!valid"
        :data-test="part('reactivate-confirm')"
        @click="submit"
      >
        Reactivate {{ copy.noun }}
      </v-btn>
    </template>
  </AppDialog>
</template>
