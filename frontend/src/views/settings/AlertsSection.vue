<script setup lang="ts">
import { Bell, CalendarClock, ChartPie, Receipt, TriangleAlert, Wallet } from '@lucide/vue'

import { currencySymbol } from '@/utils/format'
import AlertRow from '@/views/settings/AlertRow.vue'
import PreferencesGate from '@/views/settings/PreferencesGate.vue'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const amountRules = [
  (value: string) => /^\d{1,10}(\.\d{1,2})?$/.test(value) || 'Enter an amount like 250 or 99.95',
]
</script>

<template>
  <PreferencesGate v-slot="{ draft }">
    <SettingsCard
      title="Alerts"
      subtitle="Cashcove shows these alerts in the app. Turn off anything you don't want to hear about."
      :icon="Bell"
    >
      <AlertRow
        v-model:enabled="draft.alerts.subscription_due_enabled"
        :icon="CalendarClock"
        title="Upcoming subscription payments"
        description="A heads-up before a subscription renews."
        test-id="alert-subscription"
      >
        <template #default="{ disabled }">
          <v-number-input
            v-model="draft.alerts.subscription_due_days_before"
            :min="0"
            :max="30"
            :disabled="disabled"
            control-variant="split"
            label="Days before it's due"
            hide-details
          />
        </template>
      </AlertRow>

      <AlertRow
        v-model:enabled="draft.alerts.low_balance_enabled"
        :icon="Wallet"
        title="Low balance"
        description="When an account drops below this amount."
        test-id="alert-low-balance"
      >
        <template #default="{ disabled }">
          <v-text-field
            v-model="draft.alerts.low_balance_threshold"
            :prefix="currencySymbol(draft.general.currency, draft.general.locale)"
            :rules="amountRules"
            :disabled="disabled"
            inputmode="decimal"
            label="Threshold"
            hide-details="auto"
          />
        </template>
      </AlertRow>

      <AlertRow
        v-model:enabled="draft.alerts.large_transaction_enabled"
        :icon="Receipt"
        title="Large transactions"
        description="When a single transaction is bigger than this amount."
        test-id="alert-large-transaction"
      >
        <template #default="{ disabled }">
          <v-text-field
            v-model="draft.alerts.large_transaction_threshold"
            :prefix="currencySymbol(draft.general.currency, draft.general.locale)"
            :rules="amountRules"
            :disabled="disabled"
            inputmode="decimal"
            label="Threshold"
            hide-details="auto"
          />
        </template>
      </AlertRow>

      <AlertRow
        v-model:enabled="draft.alerts.budget_threshold_enabled"
        :icon="ChartPie"
        title="Budget limits"
        description="When spending in a category reaches this share of its budget."
        test-id="alert-budget"
      >
        <template #default="{ disabled }">
          <v-slider
            v-model="draft.alerts.budget_threshold_percent"
            :min="50"
            :max="150"
            :step="5"
            :disabled="disabled"
            color="primary"
            thumb-label
            hide-details
          >
            <template #append>
              <span class="text-label-large tabular-nums" style="min-width: 44px">
                {{ draft.alerts.budget_threshold_percent }}%
              </span>
            </template>
          </v-slider>
        </template>
      </AlertRow>

      <AlertRow
        v-model:enabled="draft.alerts.sync_failure_enabled"
        :icon="TriangleAlert"
        title="Sync problems"
        description="When a bank connection needs attention, for example after a password change."
        test-id="alert-sync"
      />
    </SettingsCard>
  </PreferencesGate>
</template>
