<script setup lang="ts">
import { FileSpreadsheet, Landmark, Link, Pencil } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { updateTransaction, type Transaction } from '@/api/transactions'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import CategoryChip from '@/components/finance/CategoryChip.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useImportsStore } from '@/stores/imports'
import { fromIsoDate } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'

const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  transaction: Transaction | null
  editable?: boolean
}>()
const emit = defineEmits<{
  edit: [transaction: Transaction]
  saved: [transaction: Transaction]
}>()

const accounts = useAccountsStore()
const imports = useImportsStore()
const { locale } = useHousehold()
const displayed = ref<Transaction | null>(null)
const account = computed(() => accounts.find(displayed.value?.account_id))
const importName = computed(() => imports.findImport(displayed.value?.import_id)?.file_name)
const originalDescription = computed(() => {
  const transaction = displayed.value
  return transaction?.original_description &&
    transaction.original_description.toLowerCase() !== transaction.payee.toLowerCase()
    ? transaction.original_description
    : null
})
const source = computed(() => {
  if (displayed.value?.source === 'plaid') {
    return account.value?.source === 'plaid'
      ? 'Synced from the bank through Plaid'
      : 'From a bank through Plaid'
  }
  return displayed.value?.source === 'file' ? 'Imported from a file' : 'Added manually'
})

const categorizing = useAction(async (transaction: Transaction, categoryId: string | null) => {
  if (categoryId === transaction.category_id) return
  const saved = await updateTransaction(transaction.id, { category_id: categoryId })
  displayed.value = saved
  notify('Saved the category')
  emit('saved', saved)
})

watch(
  [open, () => props.transaction],
  ([isOpen, transaction]) => {
    displayed.value = isOpen ? transaction : null
    if (isOpen && transaction?.import_id) void imports.ensureLoaded()
    categorizing.clear()
  },
  { immediate: true },
)

function changeCategory(transaction: Transaction, categoryId: string | null) {
  if (categorizing.busy.value) return
  void categorizing.run(transaction, categoryId)
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="displayed?.payee ?? 'Transaction details'"
    :icon="Landmark"
    :persistent="categorizing.busy.value"
    max-width="560"
    fullscreen-on-mobile
    data-test="transaction-info-dialog"
  >
    <template v-if="displayed">
      <div class="d-flex align-center ga-3 mb-5">
        <MoneyAmount
          :amount="displayed.amount"
          :currency="account?.currency"
          signed
          class="text-headline-small font-weight-bold"
          :class="{ 'text-medium-emphasis': displayed.pending }"
          data-test="transaction-info-amount"
        />
        <v-chip v-if="displayed.pending" color="warning" variant="tonal" size="small">
          Pending
        </v-chip>
      </div>

      <dl class="transaction-info__details">
        <div class="transaction-info__row">
          <dt>Date</dt>
          <dd>{{ formatShortDate(fromIsoDate(displayed.date), locale) }}</dd>
        </div>
        <div class="transaction-info__row">
          <dt>Account</dt>
          <dd>{{ account?.name ?? 'Deleted account' }}</dd>
        </div>
        <div class="transaction-info__row">
          <dt>Category</dt>
          <dd>
            <CategoryPicker
              v-if="editable"
              :model-value="displayed.category_id"
              label="Category"
              hide-details
              :disabled="categorizing.busy.value"
              data-test="transaction-info-category"
              @update:model-value="(categoryId) => changeCategory(displayed!, categoryId)"
            />
            <CategoryChip v-else :category-id="displayed.category_id" />
          </dd>
        </div>
        <div class="transaction-info__row">
          <dt>Source</dt>
          <dd>
            <span class="d-inline-flex align-center ga-2">
              <v-icon
                v-if="displayed.source === 'plaid'"
                :icon="account?.source === 'plaid' ? Link : Landmark"
                size="16"
              />
              <v-icon v-else-if="displayed.source === 'file'" :icon="FileSpreadsheet" size="16" />
              {{ source }}
            </span>
          </dd>
        </div>
        <div v-if="importName" class="transaction-info__row">
          <dt>File</dt>
          <dd>{{ importName }}</dd>
        </div>
        <div v-if="originalDescription" class="transaction-info__row">
          <dt>Original description</dt>
          <dd>{{ originalDescription }}</dd>
        </div>
      </dl>

      <section v-if="displayed.notes" class="mt-5" aria-label="Notes">
        <h3 class="text-label-large font-weight-bold mb-1">Notes</h3>
        <p class="text-body-medium text-medium-emphasis my-0" data-test="transaction-info-notes">
          {{ displayed.notes }}
        </p>
      </section>

      <v-alert
        v-if="categorizing.error.value"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="categorizing.error.value"
        data-test="transaction-info-error"
      />
    </template>

    <template #actions>
      <v-btn
        v-if="editable && displayed"
        :icon="Pencil"
        variant="text"
        size="small"
        :aria-label="`Edit ${displayed.payee}`"
        data-test="transaction-info-edit"
        @click="emit('edit', displayed)"
      />
      <v-btn color="primary" variant="flat" @click="open = false">Close</v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.transaction-info__details {
  margin: 0;
}

.transaction-info__row {
  display: grid;
  grid-template-columns: minmax(110px, 0.7fr) minmax(0, 1.3fr);
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.transaction-info__row:first-child {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.transaction-info__row dt {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.transaction-info__row dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
