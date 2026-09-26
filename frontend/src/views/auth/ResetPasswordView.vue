<script setup lang="ts">
import { KeyRound, Link2Off } from '@lucide/vue'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { completePasswordReset, previewPasswordReset, type PasswordResetPreview } from '@/api/auth'
import { errorMessage } from '@/api/client'
import PasswordField from '@/components/ui/PasswordField.vue'
import UsernameHint from '@/components/ui/UsernameHint.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { HOME } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/format'
import { takeLinkToken } from '@/utils/linkToken'

const auth = useAuthStore()
const router = useRouter()

const token = takeLinkToken()
const reset = ref<PasswordResetPreview | null>(null)
const problem = ref<string | null>(token ? null : "This reset link isn't complete.")
const password = ref('')

const saving = useAction(async (email: string) => {
  await completePasswordReset(token, password.value)
  password.value = ''
  // Changing the password signs that account out everywhere, including here.
  if (!auth.signedIn || auth.user?.email === email) {
    auth.forget('password_reset')
    await router.replace({ name: 'sign-in', query: { email } })
  } else {
    notify(`Password changed for ${email}.`)
    await router.replace(HOME)
  }
})

onMounted(async () => {
  if (!token) return
  try {
    reset.value = await previewPasswordReset(token)
  } catch (caught) {
    problem.value = errorMessage(caught)
  }
})
</script>

<template>
  <AuthLayout>
    <section v-if="problem" data-test="reset-problem">
      <v-avatar color="warning" variant="tonal" rounded="lg" size="52" class="mb-5">
        <v-icon :icon="Link2Off" size="26" />
      </v-avatar>
      <h1 class="text-headline-medium font-weight-bold mb-2">This link doesn't work</h1>
      <p class="text-body-large text-medium-emphasis mb-8">{{ problem }}</p>
      <v-btn color="primary" variant="flat" size="large" :to="{ name: 'sign-in' }">
        Go to sign-in
      </v-btn>
    </section>

    <section v-else-if="reset" data-test="reset-form">
      <v-avatar color="primary" variant="tonal" rounded="lg" size="52" class="mb-5">
        <v-icon :icon="KeyRound" size="26" />
      </v-avatar>
      <h1 class="text-headline-medium font-weight-bold mb-2">Choose a new password</h1>
      <p class="text-body-large text-medium-emphasis mb-8">
        For <strong data-test="reset-email">{{ reset.email }}</strong
        >. Once it's changed, you'll be signed out everywhere and can sign in with the new one.
      </p>
      <v-form @submit.prevent="saving.run(reset.email)">
        <UsernameHint :email="reset.email" />
        <PasswordField
          v-model="password"
          label="New password"
          new-password
          autofocus
          :context="{ email: reset.email, name: reset.name }"
          test-id="reset-password"
        />
        <v-alert
          v-if="saving.error.value"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          :text="saving.error.value"
          data-test="reset-error"
        />
        <v-btn
          type="submit"
          block
          size="x-large"
          color="primary"
          variant="flat"
          class="mt-6"
          :loading="saving.busy.value"
          :disabled="!password"
          data-test="reset-submit"
        >
          Change password
        </v-btn>
        <p class="text-body-small text-medium-emphasis text-center mt-4 mb-0">
          This link works once, until {{ formatDateTime(reset.expires_at) }}.
        </p>
      </v-form>
    </section>

    <v-skeleton-loader v-else type="heading, paragraph, button" data-test="reset-loading" />
  </AuthLayout>
</template>
