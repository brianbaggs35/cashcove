<script setup lang="ts">
import { Pencil, PiggyBank } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import {
  createBudget,
  updateBudget,
  type Budget,
  type BudgetChanges,
  type BudgetPeriodKind,
} from '@/api/budget'
import AppDialog from '@/components/ui/AppDialog.vue'
import DateField from '@/components/ui/DateField.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { todayIso } from '@/utils/dates'
import { perPeriod, periodHints, periodOptions } from '@/views/budget/periods'

/**
 * Makes a budget, or changes one: its name, how often it starts over and the amount it has each
 * time. What counts toward it is chosen afterwards, on the budget itself.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ budget: Budget | null }>()
const emit = defineEmits<{ saved: [budget: Budget] }>()

const form = reactive<{
  name: string
  period: BudgetPeriodKind
  amount: string | null
  startsOn: string | null
}>({ name: '', period: 'monthly', amount: null, startsOn: null })
const valid = ref(false)

const nameRules = [
  (value: string) => value.trim().length > 0 || 'Give this budget a name',
  (value: string) => value.trim().length <= 120 || 'Keep it under 120 characters',
]
const fieldError = (field: string) => saving.fields.value[field] ?? undefined

const repeating = computed(() => props.budget !== null && form.period !== props.budget.period)

function reset() {
  const budget = props.budget
  form.name = budget?.name ?? ''
  form.period = budget?.period ?? 'monthly'
  form.amount = budget?.amount ?? null
  form.startsOn = budget?.starts_on ?? null
  saving.clear()
}

watch(open, (value) => {
  if (value) reset()
})
// What the API turned down no longer applies once the form changes, so it can be sent again.
watch(form, () => {
  saving.clear()
})

const saving = useAction(async () => {
  const today = todayIso()
  const amount = form.amount as string
  const name = form.name.trim()
  const budget = props.budget
  let saved: Budget
  if (budget) {
    const changes: BudgetChanges = { today }
    if (name !== budget.name) changes.name = name
    if (form.period !== budget.period) changes.period = form.period
    if (amount !== budget.amount) changes.amount = amount
    if (form.startsOn && form.startsOn !== budget.starts_on) changes.starts_on = form.startsOn
    saved = await updateBudget(budget.id, changes)
  } else {
    saved = await createBudget({
      name,
      period: form.period,
      amount,
      starts_on: form.startsOn,
      today,
    })
  }
  notify(budget ? `Saved ${saved.name}` : `Added ${saved.name}`)
  emit('saved', saved)
  open.value = false
})

function submit() {
  if (valid.value) void saving.run()
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="budget ? 'Edit budget' : 'New budget'"
    subtitle="An amount to spend each week, month or year. Then choose what counts toward it."
    :icon="budget ? Pencil : PiggyBank"
    :persistent="saving.busy.value"
    fullscreen-on-mobile
    data-test="budget-dialog"
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <v-text-field
        v-model="form.name"
        label="Budget name"
        placeholder="e.g. Household"
        :rules="nameRules"
        :error-messages="fieldError('name')"
        autocomplete="off"
        autofocus
        data-test="budget-name"
      />
      <p class="text-label-large mb-2">How often does it start over?</p>
      <v-btn-toggle
        v-model="form.period"
        mandatory
        divided
        variant="outlined"
        color="primary"
        density="comfortable"
        aria-label="How often the budget starts over"
        class="budget-dialog__periods mb-1"
        data-test="budget-period"
      >
        <v-btn
          v-for="option in periodOptions"
          :key="option.value"
          :value="option.value"
          :data-test="`period-${option.value}`"
        >
          {{ option.title }}
        </v-btn>
      </v-btn-toggle>
      <p class="text-body-small text-medium-emphasis mb-4" data-test="budget-period-hint">
        {{ periodHints[form.period] }}
      </p>
      <MoneyField
        v-model="form.amount"
        :label="`Amount ${perPeriod[form.period]}`"
        required
        non-zero
        :error-messages="fieldError('amount')"
        data-test="budget-amount"
      />
      <DateField
        v-model="form.startsOn"
        label="A day a period starts on"
        data-test="budget-starts-on"
      />
      <p class="text-body-small text-medium-emphasis mt-n3 mb-2">
        Optional. Leave it empty to start on the usual day.
      </p>
      <v-alert
        v-if="repeating"
        type="info"
        variant="tonal"
        density="compact"
        class="mt-2"
        data-test="budget-period-change"
      >
        Changing how often it starts over starts its amount over too. Earlier periods are measured
        against the amount below.
      </v-alert>
      <v-alert
        v-if="saving.error.value"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="saving.error.value"
        data-test="budget-error"
      />
      <button type="submit" hidden />
    </v-form>
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!valid"
        data-test="budget-save"
        @click="submit"
      >
        {{ budget ? 'Save changes' : 'Add budget' }}
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.budget-dialog__periods {
  display: flex;
  width: 100%;
}

.budget-dialog__periods :deep(.v-btn) {
  flex: 1 1 0;
  min-width: 0;
}
</style>
