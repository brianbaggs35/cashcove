<script setup lang="ts">
import { ArrowRight, FileClock, Undo2 } from '@lucide/vue'
import { computed, ref } from 'vue'

import { undoImport, type FileImport } from '@/api/imports'
import EmptyState from '@/components/ui/EmptyState.vue'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useImportsStore } from '@/stores/imports'
import { formatDateRange } from '@/utils/dates'
import { toCents } from '@/utils/money'
import { formatIcon, formatName, transactionCount } from '@/views/import/file'

/** The files imported lately, newest first: what each brought in, and undoing it. */
const auth = useAuthStore()
const store = useImportsStore()
const accounts = useAccountsStore()
const { locale } = useHousehold()

/** Enough to see the latest at a glance; the rest are a click away. */
const FIRST = 5
const all = ref(false)
const shown = computed(() => (all.value ? store.imports : store.imports.slice(0, FIRST)))

const accountName = (record: FileImport) =>
  accounts.find(record.account_id)?.name ?? 'a deleted account'

function currency(record: FileImport): string | undefined {
  return accounts.find(record.account_id)?.currency
}

function details(record: FileImport): string {
  const days = formatDateRange({ start: record.first_date, end: record.last_date }, locale.value)
  return [accountName(record), transactionCount(record.added), days].join(' · ')
}

async function undo(record: FileImport) {
  const account = accountName(record)
  const balance = toCents(record.balance_change) === 0 ? '' : ' and puts its balance back'
  const done = await confirmAndRun(
    {
      title: `Undo importing ${record.file_name}?`,
      text: `This deletes the ${transactionCount(record.added)} it added to ${account}${balance}. Changes made to them since are lost.`,
      confirmText: 'Undo import',
      tone: 'error',
      icon: Undo2,
    },
    () => undoImport(record.id),
  )
  if (!done) return
  store.undone(record.id)
  void accounts.load()
  notify(`Deleted the ${transactionCount(done.result.count)} from ${record.file_name}`)
}
</script>

<template>
  <v-card class="import-history" data-test="import-history">
    <div class="d-flex align-center flex-wrap ga-2 px-5 pt-4 pb-2">
      <h2 class="text-title-medium font-weight-bold ma-0">Recent imports</h2>
      <v-chip v-if="store.imports.length" size="x-small" variant="tonal">
        {{ store.imports.length }}
      </v-chip>
    </div>

    <EmptyState
      v-if="!store.imports.length"
      :icon="FileClock"
      title="Nothing imported yet"
      text="Files you import show up here, with what each one brought in, until you undo it."
      compact
    />

    <div v-else class="px-2 pb-2">
      <div
        v-for="record in shown"
        :key="record.id"
        class="import-history__item d-flex align-start ga-4 py-3 px-3"
        data-test="import-item"
      >
        <v-avatar color="primary" variant="tonal" rounded="lg" size="40" class="flex-shrink-0">
          <v-icon :icon="formatIcon(record.format)" size="20" />
        </v-avatar>
        <div class="flex-grow-1" style="min-width: 0">
          <div class="d-flex align-start ga-3">
            <div class="flex-grow-1" style="min-width: 0">
              <div class="d-flex align-center flex-wrap ga-2">
                <span
                  class="text-title-small font-weight-bold text-break"
                  data-test="import-item-name"
                >
                  {{ record.file_name }}
                </span>
                <v-chip size="x-small" variant="tonal" label>
                  {{ formatName(record.format, record.file_name) }}
                </v-chip>
              </div>
              <div class="text-body-small text-medium-emphasis" data-test="import-item-details">
                {{ details(record) }}
              </div>
            </div>
            <MoneyAmount
              :amount="record.total"
              :currency="currency(record)"
              signed
              class="text-title-small font-weight-bold flex-shrink-0"
              data-test="import-item-total"
            />
          </div>
          <div class="text-body-small text-medium-emphasis mt-1" data-test="import-item-when">
            Imported <RelativeTime :value="record.created_at" />
            <template v-if="record.created_by"> by {{ record.created_by }}</template>
            <template v-if="record.skipped">
              · {{ record.skipped.toLocaleString('en-US') }} left out
            </template>
          </div>
          <div class="d-flex flex-wrap ga-1 mt-1 ms-n3">
            <v-btn
              variant="text"
              size="small"
              color="primary"
              :append-icon="ArrowRight"
              :to="{ path: '/transactions', query: { import: record.id } }"
              data-test="import-item-transactions"
            >
              See transactions
            </v-btn>
            <v-btn
              v-if="auth.isAdmin"
              variant="text"
              size="small"
              :prepend-icon="Undo2"
              :aria-label="`Undo importing ${record.file_name}`"
              data-test="import-item-undo"
              @click="undo(record)"
            >
              Undo
            </v-btn>
          </div>
        </div>
      </div>
      <div v-if="store.imports.length > FIRST" class="px-3 pt-1">
        <v-btn variant="text" size="small" data-test="import-history-more" @click="all = !all">
          {{ all ? 'Show fewer' : `Show all ${store.imports.length}` }}
        </v-btn>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.import-history__item {
  border-radius: 14px;
}

.import-history__item + .import-history__item {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0;
}
</style>
