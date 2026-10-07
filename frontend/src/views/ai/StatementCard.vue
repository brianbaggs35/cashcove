<script setup lang="ts">
import { CircleAlert, FileText, ListChecks, RotateCw, X } from '@lucide/vue'
import { computed } from 'vue'

import { useHousehold } from '@/composables/useHousehold'
import type { StatementReading } from '@/api/ai'
import { useAccountsStore } from '@/stores/accounts'
import { useAiStore } from '@/stores/ai'
import type { StatementMessage } from '@/stores/aiChat'
import { formatDateRange } from '@/utils/dates'
import { negate, sumAmounts, toCents } from '@/utils/money'
import { transactionCount } from '@/views/import/file'
import StatementProgress from '@/views/import/StatementProgress.vue'

/**
 * A statement the person attached, in the conversation: the AI reading it, what it found, and
 * what became of it. Reading takes a while, so it says what is happening and can be stopped.
 */
const props = defineProps<{ message: StatementMessage; opening: boolean }>()
const emit = defineEmits<{ review: []; reread: []; cancel: [] }>()

const ai = useAiStore()
const accounts = useAccountsStore()
const { locale, money } = useHousehold()

const name = computed(() => props.message.file.name)
/** Why it wasn't read, which it always says when it wasn't. */
const failure = computed(() => props.message.error as string)
// What follows is only worked out once the AI has read it, which is when it's shown.
const reading = computed(() => props.message.reading as StatementReading)
const rows = computed(() => reading.value.rows)
const dated = computed(() => rows.value.flatMap((row) => (row.date ? [row.date] : [])).sort())
const amounts = computed(() => rows.value.flatMap((row) => (row.amount ? [row.amount] : [])))
const moneyIn = computed(() => sumAmounts(amounts.value.filter((amount) => toCents(amount) > 0)))
/** What went out, as the amount it was: the label says which way. */
const moneyOut = computed(() =>
  negate(sumAmounts(amounts.value.filter((amount) => toCents(amount) < 0))),
)
/** Rows that are missing something or that the AI wasn't sure of. */
const flagged = computed(
  () => rows.value.filter((row) => row.note || row.date === null || row.amount === null).length,
)
const account = computed(() => accounts.find(reading.value.account_id))

const details = computed(() => {
  const first = dated.value[0]
  const last = dated.value.at(-1)
  const days = first && last ? formatDateRange({ start: first, end: last }, locale.value) : null
  const where = account.value
    ? `Looks like ${account.value.name}`
    : 'You choose the account in the next step'
  return [days, where].filter(Boolean).join(' · ')
})

/** Where the import went and what it added, once it has been done. */
const imported = computed(() => {
  const record = props.message.imported
  if (!record) return null
  const into = accounts.find(record.account_id)?.name ?? 'the account'
  return { text: `Imported ${transactionCount(record.added)} into ${into}.`, id: record.id }
})
</script>

<template>
  <div class="statement-card" data-test="statement-card" :data-status="message.status">
    <template v-if="message.status === 'reading'">
      <StatementProgress :file-name="name" :model="ai.modelName" />
      <v-btn
        variant="text"
        size="small"
        :prepend-icon="X"
        class="mt-2 ms-n2"
        data-test="statement-cancel"
        @click="emit('cancel')"
      >
        Stop reading
      </v-btn>
    </template>

    <template v-else-if="message.status === 'done'">
      <div class="d-flex align-start ga-3">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="40" class="flex-shrink-0">
          <v-icon :icon="FileText" size="20" />
        </v-avatar>
        <div style="min-width: 0">
          <div class="text-title-small font-weight-bold text-break" data-test="statement-found">
            Found {{ transactionCount(rows.length) }} in {{ name }}
          </div>
          <div class="text-body-small text-medium-emphasis" data-test="statement-details">
            {{ details }}
          </div>
        </div>
      </div>

      <div class="d-flex flex-wrap ga-2 mt-3" data-test="statement-figures">
        <v-chip size="small" variant="tonal" color="success" label>
          Money in {{ money(moneyIn) }}
        </v-chip>
        <v-chip size="small" variant="tonal" label>Money out {{ money(moneyOut) }}</v-chip>
        <v-chip
          v-if="flagged"
          size="small"
          variant="tonal"
          color="warning"
          label
          :prepend-icon="CircleAlert"
          data-test="statement-flagged"
        >
          {{ flagged === 1 ? '1 needs a look' : `${flagged.toLocaleString('en-US')} need a look` }}
        </v-chip>
      </div>

      <v-alert
        v-if="imported"
        type="success"
        variant="tonal"
        density="compact"
        class="mt-4"
        data-test="statement-imported"
      >
        {{ imported.text }}
        <template #append>
          <v-btn
            :to="{ path: '/transactions', query: { import: imported.id } }"
            variant="text"
            size="small"
            data-test="statement-see"
          >
            See them
          </v-btn>
        </template>
      </v-alert>
      <div v-else class="mt-4">
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="ListChecks"
          :loading="opening"
          data-test="statement-review"
          @click="emit('review')"
        >
          Review and import
          <template #loader>
            <v-progress-circular indeterminate size="20" width="2" aria-hidden="true" />
          </template>
        </v-btn>
        <p class="text-body-small text-medium-emphasis mt-2 mb-0">
          Nothing is added until you’ve checked it.
        </p>
      </div>
    </template>

    <template v-else-if="message.status === 'failed'">
      <v-alert
        type="error"
        variant="tonal"
        density="compact"
        :text="failure"
        data-test="statement-error"
      />
      <v-btn
        variant="tonal"
        size="small"
        :prepend-icon="RotateCw"
        class="mt-3"
        data-test="statement-reread"
        @click="emit('reread')"
      >
        Try again
      </v-btn>
    </template>

    <template v-else>
      <p class="text-body-medium mb-2" data-test="statement-stopped">Stopped reading {{ name }}.</p>
      <v-btn
        variant="tonal"
        size="small"
        :prepend-icon="RotateCw"
        data-test="statement-reread"
        @click="emit('reread')"
      >
        Read it again
      </v-btn>
    </template>
  </div>
</template>

<style scoped>
.statement-card {
  min-width: min(100%, 320px);
}
</style>
