<script setup lang="ts">
import { Check, Landmark, Link, Pencil } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import { createAccount, updateAccount, type Account, type AccountType } from '@/api/accounts'
import { accountType, accountTypes } from '@/components/finance/accountTypes'
import AppDialog from '@/components/ui/AppDialog.vue'
import MoneyField from '@/components/ui/MoneyField.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAccountsStore } from '@/stores/accounts'
import { negate } from '@/utils/money'
import { currencyOptions } from '@/utils/regional'

/**
 * Adds an account kept by hand, or edits one. Plaid keeps a linked account's balance and details
 * up to date, so only its name and notes change here.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ account: Account | null }>()

const accounts = useAccountsStore()
const household = useHousehold()

interface AccountForm {
  type: AccountType
  name: string
  institution: string
  mask: string
  currency: string
  balance: string | null
  creditLimit: string | null
  notes: string
}

const form = reactive<AccountForm>({
  type: 'checking',
  name: '',
  institution: '',
  mask: '',
  currency: 'USD',
  balance: null,
  creditLimit: null,
  notes: '',
})
const valid = ref(false)

const linked = computed(() => props.account?.source === 'plaid')
/** The bank's own name for a linked account, and where it is. */
const linkedName = computed(() => {
  const account = props.account as Account
  const name = account.official_name ?? account.name
  return account.institution ? `${name} at ${account.institution}` : name
})
const liability = computed(() => accountType(form.type).liability)
const title = computed(() => (props.account ? `Edit ${props.account.name}` : 'Add an account'))

/** Cards and loans are entered as what's owed; the API keeps that as a negative balance. */
const toForm = (account: Account) =>
  accountType(account.type).liability ? negate(account.balance) : account.balance
const fromForm = (amount: string) => (liability.value ? negate(amount) : amount)

function reset() {
  const account = props.account
  form.type = account?.type ?? 'checking'
  form.name = account?.name ?? ''
  form.institution = account?.institution ?? ''
  form.mask = account?.mask ?? ''
  form.currency = account?.currency ?? household.currency.value
  form.balance = account ? toForm(account) : null
  form.creditLimit = account?.credit_limit ?? null
  form.notes = account?.notes ?? ''
  saving.clear()
}

watch(open, (value) => {
  if (value) reset()
})

const blank = (text: string) => text.trim() || null

/** Everything but the name and notes, which is all a linked account changes. */
function details() {
  return {
    type: form.type,
    institution: blank(form.institution),
    mask: blank(form.mask),
    currency: form.currency,
    // The form doesn't submit without a balance.
    balance: fromForm(form.balance as string),
    credit_limit: form.type === 'credit_card' ? form.creditLimit : null,
  }
}

const saving = useAction(async () => {
  const name = form.name.trim()
  const notes = blank(form.notes)
  const account = props.account
  // The bank keeps a linked account's details, so only its name and notes change.
  const changes = linked.value ? { name, notes } : { name, notes, ...details() }
  const saved = account
    ? await updateAccount(account.id, changes)
    : await createAccount({ name, notes, ...details() })
  accounts.put(saved)
  notify(account ? `Saved ${saved.name}` : `Added ${saved.name}`)
  open.value = false
})

// What the API rejected no longer applies once the form changes, so it can be sent again.
watch(form, () => {
  saving.clear()
})

function submit() {
  if (valid.value) void saving.run()
}

const nameRules = [
  (value: string) => value.trim().length > 0 || 'Give the account a name',
  (value: string) => value.trim().length <= 80 || 'Keep it under 80 characters',
]
const institutionRules = [
  (value: string) => value.trim().length <= 80 || 'Keep it under 80 characters',
]
const maskRules = [
  (value: string) =>
    !value.trim() || /^[A-Za-z0-9]{2,4}$/.test(value.trim()) || 'Enter 2 to 4 letters or digits',
]
const notesRules = [(value: string) => value.length <= 500 || 'Keep notes under 500 characters']

const fieldError = (field: string) => saving.fields.value[field] ?? undefined
const formError = computed(() =>
  Object.keys(saving.fields.value).length ? null : saving.error.value,
)
</script>

<template>
  <AppDialog
    v-model="open"
    :title="title"
    :subtitle="
      linked
        ? 'Plaid keeps this account\'s balance and details up to date. You can rename it and add notes.'
        : account
          ? 'Its balance moves with the transactions you add here.'
          : 'Keep track of an account by hand. Its balance moves with the transactions you add.'
    "
    :icon="account ? Pencil : Landmark"
    :persistent="saving.busy.value"
    max-width="640"
    fullscreen-on-mobile
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <template v-if="!linked">
        <div id="account-type-label" class="text-label-large mb-2">What kind of account?</div>
        <v-item-group
          v-model="form.type"
          mandatory
          class="account-types mb-6"
          role="radiogroup"
          aria-labelledby="account-type-label"
        >
          <v-item
            v-for="option in accountTypes"
            :key="option.value"
            v-slot="{ isSelected, toggle }"
            :value="option.value"
          >
            <v-card
              tag="button"
              type="button"
              :color="isSelected ? 'primary' : undefined"
              :variant="isSelected ? 'tonal' : 'outlined'"
              class="account-type d-flex align-center ga-2 px-3 py-2 text-start"
              role="radio"
              :aria-checked="isSelected"
              :data-test="`account-type-${option.value}`"
              @click="toggle"
            >
              <v-icon :icon="option.icon" size="18" />
              <span class="text-body-medium font-weight-medium flex-grow-1">{{
                option.title
              }}</span>
              <v-icon v-if="isSelected" :icon="Check" size="16" />
            </v-card>
          </v-item>
        </v-item-group>
      </template>
      <v-alert
        v-else-if="account"
        :icon="Link"
        color="secondary"
        variant="tonal"
        density="compact"
        class="mb-5"
        data-test="account-linked-notice"
      >
        {{ linkedName }}
      </v-alert>

      <v-text-field
        v-model="form.name"
        label="Name"
        autocomplete="off"
        :autofocus="!account"
        counter="80"
        :rules="nameRules"
        :error-messages="fieldError('name')"
        data-test="account-name-field"
      />

      <template v-if="!linked">
        <v-row dense class="mt-1">
          <v-col cols="12" sm="8">
            <v-text-field
              v-model="form.institution"
              label="Bank or institution"
              hint="Optional"
              autocomplete="off"
              :rules="institutionRules"
              :error-messages="fieldError('institution')"
              data-test="account-institution"
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="form.mask"
              label="Last digits"
              hint="To tell accounts apart"
              autocomplete="off"
              maxlength="4"
              :rules="maskRules"
              :error-messages="fieldError('mask')"
              data-test="account-mask"
            />
          </v-col>
          <!-- On phones the currency comes next, so its label needs room below this hint. -->
          <v-col cols="12" sm="8" class="mb-2 mb-sm-0">
            <MoneyField
              v-model="form.balance"
              :label="liability ? 'Amount owed' : 'Current balance'"
              :currency="form.currency"
              :hint="
                liability
                  ? 'What you owe today. Use a minus sign for a credit.'
                  : 'What\'s in it today. Use a minus sign if it\'s overdrawn.'
              "
              persistent-hint
              required
              allow-negative
              :error-messages="fieldError('balance')"
              data-test="account-balance-field"
            />
          </v-col>
          <v-col cols="12" sm="4">
            <v-autocomplete
              v-model="form.currency"
              :items="currencyOptions"
              label="Currency"
              :error-messages="fieldError('currency')"
              data-test="account-currency"
            >
              <template #selection="{ item }">{{ item.value }}</template>
            </v-autocomplete>
          </v-col>
          <v-col v-if="form.type === 'credit_card'" cols="12" sm="8">
            <MoneyField
              v-model="form.creditLimit"
              label="Credit limit"
              :currency="form.currency"
              hint="Optional. Shows how much of it is in use."
              persistent-hint
              :error-messages="fieldError('credit_limit')"
              data-test="account-credit-limit"
            />
          </v-col>
        </v-row>
      </template>

      <v-textarea
        v-model="form.notes"
        label="Notes"
        hint="Optional"
        rows="2"
        auto-grow
        counter="500"
        class="mt-2"
        :rules="notesRules"
        :error-messages="fieldError('notes')"
        data-test="account-notes"
      />

      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="formError"
        data-test="account-error"
      />
      <!-- Lets Enter submit the form. -->
      <button type="submit" hidden />
    </v-form>

    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!valid"
        data-test="account-save"
        @click="submit"
      >
        {{ account ? 'Save changes' : 'Add account' }}
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.account-types {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}

.account-type {
  cursor: pointer;
}

.account-type.v-card--variant-outlined {
  border-color: rgba(var(--v-border-color), 0.2);
}
</style>
