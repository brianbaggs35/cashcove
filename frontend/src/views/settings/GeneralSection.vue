<script setup lang="ts">
import { Calendar, House } from '@lucide/vue'

import { currencyName, formatMoney, formatShortDate, localeName, monthName } from '@/utils/format'
import PreferencesGate from '@/views/settings/PreferencesGate.vue'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const CURRENCIES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'NZD',
  'JPY',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'MXN',
  'BRL',
  'INR',
  'CNY',
  'SGD',
  'HKD',
  'ZAR',
]
const LOCALES = [
  'en-US',
  'en-CA',
  'en-GB',
  'en-AU',
  'fr-CA',
  'fr-FR',
  'de-DE',
  'es-ES',
  'es-MX',
  'it-IT',
  'nl-NL',
  'pt-BR',
  'ja-JP',
]

const currencies = CURRENCIES.map((code) => ({
  value: code,
  title: `${code} · ${currencyName(code)}`,
}))
const locales = LOCALES.map((code) => ({ value: code, title: localeName(code) }))
const months = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  title: monthName(index + 1),
}))

const rules = {
  name: [
    (value: string) => value.trim().length > 0 || 'Give your household a name',
    (value: string) => value.length <= 80 || 'Keep it under 80 characters',
  ],
}
const today = new Date()
</script>

<template>
  <PreferencesGate v-slot="{ draft }">
    <SettingsCard title="Household" subtitle="Shown across Cashcove and on alerts." :icon="House">
      <v-text-field
        v-model="draft.general.household_name"
        label="Household name"
        :rules="rules.name"
        counter="80"
        data-test="household-name"
      />
    </SettingsCard>

    <SettingsCard
      title="Money and calendar"
      subtitle="How amounts and dates are shown, and when your budget year starts."
      :icon="Calendar"
    >
      <v-row>
        <v-col cols="12" sm="6">
          <v-autocomplete
            v-model="draft.general.currency"
            :items="currencies"
            label="Currency"
            data-test="currency"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="draft.general.locale"
            :items="locales"
            label="Number and date format"
            data-test="locale"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="draft.general.fiscal_year_start_month"
            :items="months"
            label="Budget year starts in"
            data-test="fiscal-month"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <div class="text-label-large mb-2">Week starts on</div>
          <v-btn-toggle
            v-model="draft.general.week_starts_on"
            mandatory
            divided
            variant="outlined"
            color="primary"
            density="comfortable"
            data-test="week-start"
          >
            <v-btn value="sunday">Sunday</v-btn>
            <v-btn value="monday">Monday</v-btn>
          </v-btn-toggle>
        </v-col>
      </v-row>
      <v-sheet
        rounded="lg"
        class="preview d-flex flex-wrap ga-6 pa-4 mt-2"
        data-test="format-preview"
      >
        <div>
          <div class="text-label-medium text-medium-emphasis">Amounts look like</div>
          <div class="text-title-medium font-weight-bold tabular-nums">
            {{ formatMoney(1234.56, draft.general.currency, draft.general.locale) }}
          </div>
        </div>
        <div>
          <div class="text-label-medium text-medium-emphasis">Dates look like</div>
          <div class="text-title-medium font-weight-bold">
            {{ formatShortDate(today, draft.general.locale) }}
          </div>
        </div>
      </v-sheet>
    </SettingsCard>
  </PreferencesGate>
</template>

<style scoped>
.preview {
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px dashed rgba(var(--v-theme-primary), 0.3);
}
</style>
