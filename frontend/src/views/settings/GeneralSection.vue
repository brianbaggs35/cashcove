<script setup lang="ts">
import { Calendar, House } from '@lucide/vue'

import FormatPreview from '@/components/FormatPreview.vue'
import { currencyOptions, localeOptions, monthOptions } from '@/utils/regional'
import PreferencesGate from '@/views/settings/PreferencesGate.vue'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const rules = {
  name: [
    (value: string) => value.trim().length > 0 || 'Give your household a name',
    (value: string) => value.length <= 80 || 'Keep it under 80 characters',
  ],
}
</script>

<template>
  <PreferencesGate v-slot="{ draft, readonly }">
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
            :items="currencyOptions"
            label="Currency"
            data-test="currency"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="draft.general.locale"
            :items="localeOptions"
            label="Number and date format"
            data-test="locale"
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select
            v-model="draft.general.fiscal_year_start_month"
            :items="monthOptions"
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
            :disabled="readonly"
            data-test="week-start"
          >
            <v-btn value="sunday">Sunday</v-btn>
            <v-btn value="monday">Monday</v-btn>
          </v-btn-toggle>
        </v-col>
      </v-row>
      <FormatPreview
        :currency="draft.general.currency"
        :locale="draft.general.locale"
        class="mt-2"
      />
    </SettingsCard>
  </PreferencesGate>
</template>
