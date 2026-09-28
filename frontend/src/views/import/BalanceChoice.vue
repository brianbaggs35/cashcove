<script setup lang="ts">
import { computed } from 'vue'

import type { Account } from '@/api/accounts'
import type { BalanceChoice, ImportBalance, ImportPreview } from '@/api/imports'
import { accountType } from '@/components/finance/accountTypes'
import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { useHousehold } from '@/composables/useHousehold'
import { useImportWizard } from '@/stores/importWizard'
import { formatListDate } from '@/utils/dates'
import { negate, sumAmounts } from '@/utils/money'

/** What importing does to an account kept by hand's balance, with what each choice leaves it at. */
const wizard = useImportWizard()
const { locale, money } = useHousehold()

const account = computed(() => wizard.account as Account)
const info = computed(() => (wizard.preview as ImportPreview).balance as ImportBalance)
/** Cards and loans show what's owed. */
const owed = computed(() => accountType(account.value.type).liability)
const shown = (amount: string) => (owed.value ? negate(amount) : amount)

interface Choice {
  value: BalanceChoice
  title: string
  text: string
  after: string
}

function fileChoice({ closing, closing_date }: ImportBalance): Choice[] {
  if (closing === null) return []
  const day = closing_date ? ` on ${formatListDate(closing_date, locale.value)}` : ''
  return [
    {
      value: 'file',
      title: 'Use the file’s balance',
      text: `What the file says it was${day}`,
      after: closing,
    },
  ]
}

const choices = computed((): Choice[] => {
  const { current } = info.value
  const total = money(wizard.selectedTotal, account.value.currency, 'exceptZero')
  return [
    ...fileChoice(info.value),
    {
      value: 'move',
      title: 'Add what’s imported',
      text: `Moves it by ${total}, as adding them by hand would`,
      after: sumAmounts([current, wizard.selectedTotal]),
    },
    {
      value: 'keep',
      title: 'Leave it as it is',
      text: 'For history the balance already counts',
      after: current,
    },
  ]
})
</script>

<template>
  <fieldset class="balance-choice" data-test="balance-choice">
    <legend class="text-title-small font-weight-bold">{{ account.name }}’s balance</legend>
    <p class="text-body-small text-medium-emphasis mt-1 mb-3">
      It’s {{ money(shown(info.current), account.currency) }}{{ owed ? ' owed' : '' }} now.
    </p>
    <v-radio-group v-model="wizard.balance" hide-details class="balance-choice__options">
      <div
        v-for="choice in choices"
        :key="choice.value"
        class="balance-choice__option px-3 py-2"
        :class="{ 'balance-choice__option--chosen': wizard.balance === choice.value }"
      >
        <v-radio :value="choice.value" color="primary" :data-test="`balance-${choice.value}`">
          <template #label>
            <span class="d-flex align-center ga-3 flex-grow-1">
              <span class="flex-grow-1">
                <span class="d-flex align-center flex-wrap ga-2 text-body-large">
                  {{ choice.title }}
                  <v-chip
                    v-if="choice.value === info.suggested"
                    size="x-small"
                    color="success"
                    variant="tonal"
                    data-test="balance-suggested"
                  >
                    Suggested
                  </v-chip>
                </span>
                <span class="d-block text-body-small text-medium-emphasis">{{ choice.text }}</span>
              </span>
              <span class="text-end flex-shrink-0">
                <MoneyAmount
                  :amount="shown(choice.after)"
                  :currency="account.currency"
                  class="d-block text-body-large font-weight-bold"
                />
                <span class="d-block text-label-small text-medium-emphasis">
                  {{ owed ? 'owed after' : 'after' }}
                </span>
              </span>
            </span>
          </template>
        </v-radio>
      </div>
    </v-radio-group>
  </fieldset>
</template>

<style scoped>
.balance-choice {
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.balance-choice__option {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.balance-choice__option + .balance-choice__option {
  margin-top: 8px;
}

.balance-choice__option--chosen {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
}

.balance-choice__option :deep(.v-label) {
  width: 100%;
  opacity: 1;
}
</style>
