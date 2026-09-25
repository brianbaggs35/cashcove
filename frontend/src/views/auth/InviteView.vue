<script setup lang="ts">
import { ArrowRight, Link2Off, LogOut, MailOpen } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { acceptInvitation, previewInvitation, type InvitationPreview } from '@/api/auth'
import { errorMessage } from '@/api/client'
import SecureAccountStep from '@/components/auth/SecureAccountStep.vue'
import PasswordField from '@/components/ui/PasswordField.vue'
import RoleChip from '@/components/ui/RoleChip.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { HOME } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { formatShortDate } from '@/utils/format'
import { takeLinkToken } from '@/utils/linkToken'

const auth = useAuthStore()
const router = useRouter()

const token = takeLinkToken()
const invitation = ref<InvitationPreview | null>(null)
const problem = ref<string | null>(token ? null : "This invitation link isn't complete.")
const name = ref('')
const password = ref('')
const joined = ref(false)
const signedInElsewhere = ref(auth.signedIn)

const firstName = computed(() => name.value.trim().split(/\s+/)[0])

const joining = useAction(async () => {
  const state = await acceptInvitation(token, name.value.trim(), password.value)
  auth.apply(state)
  password.value = ''
  joined.value = true
})

async function signOutFirst() {
  await auth.signOut()
  signedInElsewhere.value = false
}

async function finish(household: string) {
  notify(`Welcome to ${household}!`)
  await router.replace(HOME)
}

onMounted(async () => {
  if (!token) return
  try {
    invitation.value = await previewInvitation(token)
    name.value = invitation.value.name
  } catch (caught) {
    problem.value = errorMessage(caught)
  }
})
</script>

<template>
  <AuthLayout :width="480">
    <section v-if="problem" data-test="invite-problem">
      <v-avatar color="warning" variant="tonal" rounded="lg" size="52" class="mb-5">
        <v-icon :icon="Link2Off" size="26" />
      </v-avatar>
      <h1 class="text-headline-medium font-weight-bold mb-2">This link doesn't work</h1>
      <p class="text-body-large text-medium-emphasis mb-8">{{ problem }}</p>
      <v-btn color="primary" variant="flat" size="large" :to="{ name: 'sign-in' }">
        Go to sign-in
      </v-btn>
    </section>

    <section v-else-if="invitation && joined" data-test="invite-secure">
      <h1 class="text-headline-medium font-weight-bold mb-2">
        You're in{{ firstName ? `, ${firstName}` : '' }}
      </h1>
      <p class="text-body-large text-medium-emphasis mb-8">
        One more thing: add a second way to prove it's you, so a stolen password isn't enough.
      </p>
      <SecureAccountStep @continue="finish(invitation.household_name)" />
    </section>

    <section v-else-if="invitation" data-test="invite-form">
      <v-avatar color="primary" variant="tonal" rounded="lg" size="52" class="mb-5">
        <v-icon :icon="MailOpen" size="26" />
      </v-avatar>
      <h1 class="text-headline-medium font-weight-bold mb-2">
        Join {{ invitation.household_name }}
      </h1>
      <p class="text-body-large text-medium-emphasis mb-6">
        {{ invitation.invited_by ?? 'An admin' }} invited you to Cashcove, where your household
        keeps track of its money together.
      </p>

      <div class="invite__summary d-flex flex-wrap align-center ga-3 pa-4 mb-8">
        <div class="flex-grow-1" style="min-width: 0">
          <div class="text-label-medium text-medium-emphasis">You'll sign in as</div>
          <div class="text-title-small font-weight-bold text-truncate" data-test="invite-email">
            {{ invitation.email }}
          </div>
        </div>
        <RoleChip :role="invitation.role" />
      </div>

      <v-alert
        v-if="signedInElsewhere"
        type="info"
        variant="tonal"
        class="mb-6"
        data-test="invite-signed-in"
      >
        You're signed in as {{ auth.user?.email }}. Sign out to accept this invitation.
        <template #append>
          <v-btn variant="text" :prepend-icon="LogOut" @click="signOutFirst">Sign out</v-btn>
        </template>
      </v-alert>

      <v-form v-else @submit.prevent="joining.run()">
        <v-text-field
          v-model="name"
          label="Your name"
          autocomplete="name"
          class="mb-2"
          :rules="[(value: string) => value.trim().length > 0 || 'Tell us your name']"
          data-test="invite-name"
        />
        <!-- Lets password managers save the new password under the right email. -->
        <input type="email" :value="invitation.email" autocomplete="username" hidden readonly />
        <PasswordField
          v-model="password"
          label="Choose a password"
          autocomplete="new-password"
          meter
          :context="{ email: invitation.email, name }"
          test-id="invite-password"
        />
        <v-alert
          v-if="joining.error.value"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          :text="joining.error.value"
          data-test="invite-error"
        />
        <v-btn
          type="submit"
          block
          size="x-large"
          color="primary"
          variant="flat"
          class="mt-6"
          :append-icon="ArrowRight"
          :loading="joining.busy.value"
          :disabled="!name.trim() || !password"
          data-test="invite-submit"
        >
          Create my account
        </v-btn>
        <p class="text-body-small text-medium-emphasis text-center mt-4 mb-0">
          This invitation works once and expires on
          {{ formatShortDate(new Date(invitation.expires_at)) }}.
        </p>
      </v-form>
    </section>

    <v-skeleton-loader v-else type="heading, paragraph, button" data-test="invite-loading" />
  </AuthLayout>
</template>

<style scoped>
.invite__summary {
  border-radius: 16px;
  background: rgba(var(--v-theme-surface-variant), 0.6);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
