<script setup lang="ts">
import { CircleUserRound, KeyRound, Save, Undo2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { changePassword, updateProfile } from '@/api/account'
import { passwordProblem } from '@/auth/password'
import { signalUserDetails } from '@/auth/passkeys'
import PasswordField from '@/components/ui/PasswordField.vue'
import RoleChip from '@/components/ui/RoleChip.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import UsernameHint from '@/components/ui/UsernameHint.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useAuthStore } from '@/stores/auth'
import { isEmail } from '@/utils/email'
import { formatShortDate } from '@/utils/format'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const auth = useAuthStore()
const user = computed(() => auth.user)

// ---- Profile ----

const name = ref('')
const email = ref('')

function resetProfile() {
  name.value = user.value?.name ?? ''
  email.value = user.value?.email ?? ''
  saving.clear()
}

const emailChanged = computed(() => email.value.trim().toLowerCase() !== user.value?.email)
const profileChanged = computed(() => name.value.trim() !== user.value?.name || emailChanged.value)
const profileValid = computed(
  () => name.value.trim().length > 0 && name.value.trim().length <= 80 && isEmail(email.value),
)

const nameRules = [
  (value: string) => value.trim().length > 0 || 'Enter your name',
  (value: string) => value.trim().length <= 80 || 'Keep it under 80 characters',
]
const emailRules = [(value: string) => isEmail(value) || 'Enter a valid email address']

const saving = useAction(async () => {
  const before = user.value
  const updated = await updateProfile(name.value.trim(), email.value.trim())
  auth.updateUser(updated)
  name.value = updated.name
  email.value = updated.email
  // Password managers show the name and email saved with a passkey; this keeps them current.
  if (updated.passkey_count > 0) {
    void signalUserDetails(auth.origin, updated.webauthn_user_id, updated.email, updated.name)
  }
  notify(
    updated.email === before?.email
      ? 'Profile saved'
      : `Saved. From now on, sign in with ${updated.email}.`,
  )
})

const nameError = computed(() => saving.fields.value.name)
const emailError = computed(
  () =>
    saving.fields.value.email ?? (saving.code.value === 'email_taken' ? saving.error.value : null),
)
const profileError = computed(() =>
  nameError.value || emailError.value ? null : saving.error.value,
)

// The form follows the account, e.g. after it's refreshed, unless there are unsaved edits:
// changes to the form compared with the account as it was.
watch(
  user,
  (_, previous) => {
    const edited =
      previous &&
      (name.value.trim() !== previous.name || email.value.trim().toLowerCase() !== previous.email)
    if (!edited) resetProfile()
  },
  { immediate: true },
)

// ---- Password ----

const currentPassword = ref('')
const newPassword = ref('')
const passwordContext = computed(() => ({ email: user.value?.email, name: user.value?.name }))

const passwordReady = computed(
  () =>
    currentPassword.value.length > 0 &&
    newPassword.value !== currentPassword.value &&
    passwordProblem(newPassword.value, passwordContext.value) === null,
)

const changing = useAction(async () => {
  await changePassword(currentPassword.value, newPassword.value)
  currentPassword.value = ''
  newPassword.value = ''
  notify('Password changed. Any other devices you were signed in on have been signed out.')
})

const currentPasswordError = computed(
  () =>
    changing.fields.value.current_password ??
    (changing.code.value === 'wrong_password' ? changing.error.value : null),
)
const newPasswordError = computed(
  () =>
    changing.fields.value.new_password ??
    (changing.code.value === 'weak_password' ? changing.error.value : null),
)
const passwordError = computed(() =>
  currentPasswordError.value || newPasswordError.value ? null : changing.error.value,
)
const samePassword = computed(
  () => newPassword.value.length > 0 && newPassword.value === currentPassword.value,
)
</script>

<template>
  <template v-if="user">
    <SettingsCard
      title="Profile"
      subtitle="How you appear in Cashcove, and the email you sign in with."
      :icon="CircleUserRound"
    >
      <div class="account-identity d-flex align-center ga-4 pa-4 mb-6">
        <UserAvatar :name="user.name" size="56" />
        <div class="flex-grow-1" style="min-width: 0">
          <div class="d-flex flex-wrap align-center ga-2">
            <span class="text-title-medium font-weight-bold text-truncate">{{ user.name }}</span>
            <RoleChip :role="user.role" size="x-small" />
          </div>
          <div class="text-body-medium text-medium-emphasis text-truncate">{{ user.email }}</div>
          <div class="text-body-small text-medium-emphasis mt-1" data-test="account-role-summary">
            <template v-if="user.role === 'admin'">
              As an admin, you can change anything in Cashcove, including who has access.
            </template>
            <template v-else>
              As a viewer, you can see everything in Cashcove but not change it. Your own sign-in
              and security settings are still yours to manage.
            </template>
            Member since {{ formatShortDate(new Date(user.created_at)) }}.
          </div>
        </div>
      </div>

      <v-form @submit.prevent="profileChanged && profileValid && saving.run()">
        <v-row>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="name"
              label="Your name"
              autocomplete="name"
              :rules="nameRules"
              :error-messages="nameError ?? undefined"
              data-test="profile-name"
            />
          </v-col>
          <v-col cols="12" sm="6">
            <v-text-field
              v-model="email"
              label="Email"
              type="email"
              autocomplete="email"
              autocapitalize="off"
              spellcheck="false"
              :rules="emailRules"
              :error-messages="emailError ?? undefined"
              :hint="
                emailChanged
                  ? `You'll confirm it's you, then sign in with the new email from now on.`
                  : 'You sign in with this email.'
              "
              persistent-hint
              data-test="profile-email"
            />
          </v-col>
        </v-row>
        <v-alert
          v-if="profileError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          :text="profileError"
          data-test="profile-error"
        />
        <div class="d-flex flex-wrap justify-end ga-2 mt-4">
          <v-btn
            v-if="profileChanged"
            variant="text"
            :prepend-icon="Undo2"
            :disabled="saving.busy.value"
            data-test="profile-reset"
            @click="resetProfile"
          >
            Undo changes
          </v-btn>
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            :prepend-icon="Save"
            :loading="saving.busy.value"
            :disabled="!profileChanged || !profileValid"
            data-test="profile-save"
          >
            Save profile
          </v-btn>
        </div>
      </v-form>
    </SettingsCard>

    <SettingsCard
      title="Password"
      subtitle="Changing it signs you out on every other device, so use this if you think someone else knows it."
      :icon="KeyRound"
    >
      <v-form class="account-password" @submit.prevent="passwordReady && changing.run()">
        <UsernameHint :email="user.email" />
        <PasswordField
          v-model="currentPassword"
          label="Current password"
          :error-messages="currentPasswordError ?? undefined"
          test-id="current-password"
          class="mb-4"
        />
        <PasswordField
          v-model="newPassword"
          label="New password"
          new-password
          :context="passwordContext"
          :error-messages="
            newPasswordError ??
            (samePassword ? 'Choose a password different from your current one.' : undefined)
          "
          test-id="new-password"
        />
        <v-alert
          v-if="passwordError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          :text="passwordError"
          data-test="password-error"
        />
        <div class="d-flex justify-end mt-4">
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            :prepend-icon="KeyRound"
            :loading="changing.busy.value"
            :disabled="!passwordReady"
            data-test="password-save"
          >
            Change password
          </v-btn>
        </div>
      </v-form>
    </SettingsCard>
  </template>
</template>

<style scoped>
.account-identity {
  border-radius: 16px;
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px solid rgba(var(--v-theme-primary), 0.12);
}

.account-password {
  max-width: 520px;
}
</style>
