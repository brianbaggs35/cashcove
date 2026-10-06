<script setup lang="ts">
import { ArrowDownLeft, ArrowUpRight, CircleAlert, Pencil } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import type { StatementRow } from '@/api/ai'
import AppDialog from '@/components/ui/AppDialog.vue'
import DateField from '@/components/ui/DateField.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import { useImportWizard } from '@/stores/importWizard'
import { todayIso } from '@/utils/dates'
import { negate, toCents } from '@/utils/money'

/**
 * Correcting a transaction the AI read off a statement: its date, who it was with and its
 * amount, which way round. It can get any of them wrong, and a row it couldn't read at all is
 * mended here.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ row: StatementRow | null }>()

const wizard = useImportWizard()

const form = reactive<{
  date: string | null
  payee: string
  direction: 'in' | 'out'
  /** Always positive; the direction says which way the money went. */
  amount: string | null
}>({ date: null, payee: '', direction: 'out', amount: null })
const valid = ref(false)

const maxDate = computed(() => todayIso())
const payeeRules = [(value: string) => !!value.trim() || 'Enter who it was with']

watch(open, (value) => {
  const row = props.row
  if (!value || !row) return
  form.date = row.date
  form.payee = row.payee
  form.direction = row.amount !== null && toCents(row.amount) > 0 ? 'in' : 'out'
  form.amount = row.amount !== null && toCents(row.amount) < 0 ? negate(row.amount) : row.amount
})

function save() {
  if (!valid.value || !props.row) return
  const amount = form.amount as string
  wizard.editRow(props.row.line, {
    date: form.date,
    payee: form.payee.trim(),
    amount: form.direction === 'out' ? negate(amount) : amount,
  })
  open.value = false
}
</script>

<template>
  <AppDialog
    v-model="open"
    title="Check this transaction"
    subtitle="The AI read it off your statement. Change anything it got wrong."
    :icon="Pencil"
    max-width="520"
    fullscreen-on-mobile
  >
    <v-alert
      v-if="row?.note"
      :icon="CircleAlert"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-5"
      :text="row.note"
      data-test="statement-row-note"
    />

    <v-form v-model="valid" @submit.prevent="save">
      <v-btn-toggle
        v-model="form.direction"
        mandatory
        divided
        variant="outlined"
        density="comfortable"
        color="primary"
        class="mb-4"
        aria-label="Direction"
        data-test="statement-row-direction"
      >
        <v-btn value="out" :prepend-icon="ArrowUpRight">Money out</v-btn>
        <v-btn value="in" :prepend-icon="ArrowDownLeft">Money in</v-btn>
      </v-btn-toggle>

      <v-row density="compact">
        <v-col cols="12" sm="6">
          <MoneyField
            v-model="form.amount"
            label="Amount"
            :currency="wizard.account?.currency"
            required
            non-zero
            data-test="statement-row-amount"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <DateField
            v-model="form.date"
            label="Date"
            min="1970-01-01"
            :max="maxDate"
            required
            data-test="statement-row-date"
          />
        </v-col>
        <v-col cols="12">
          <v-text-field
            v-model="form.payee"
            label="Who it was with"
            maxlength="200"
            counter="200"
            :rules="payeeRules"
            data-test="statement-row-payee"
          />
        </v-col>
      </v-row>
    </v-form>

    <template #actions>
      <v-btn variant="text" data-test="statement-row-cancel" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :disabled="!valid"
        data-test="statement-row-save"
        @click="save"
      >
        Save
      </v-btn>
    </template>
  </AppDialog>
</template>
