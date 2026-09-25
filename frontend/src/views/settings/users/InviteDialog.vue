<script setup lang="ts">
import { Check, Crown, Eye, MailPlus, UserPlus, type LucideIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import type { Role } from '@/api/auth'
import { inviteMember, type Invitation, type InvitationLink } from '@/api/users'
import AppDialog from '@/components/ui/AppDialog.vue'
import CopyField from '@/components/ui/CopyField.vue'
import { useAction } from '@/composables/useAction'
import { formatDateTime } from '@/utils/format'

/** Invites someone to the household: their details and role, then a link to send them. */
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ invited: [invitation: Invitation] }>()

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLES: { value: Role; title: string; icon: LucideIcon; text: string }[] = [
  {
    value: 'viewer',
    title: 'Viewer',
    icon: Eye,
    text: 'Sees everything, changes nothing. Good for someone who just needs to look.',
  },
  {
    value: 'admin',
    title: 'Admin',
    icon: Crown,
    text: 'Can change anything, including who has access. Best kept to people you fully trust.',
  },
]

const name = ref('')
const email = ref('')
const role = ref<Role>('viewer')
const result = ref<InvitationLink | null>(null)

const nameRules = [
  (value: string) => value.trim().length > 0 || 'Enter their name',
  (value: string) => value.trim().length <= 80 || 'Keep it under 80 characters',
]
const emailRules = [(value: string) => EMAIL.test(value.trim()) || 'Enter a valid email address']
const valid = computed(
  () =>
    name.value.trim().length > 0 &&
    name.value.trim().length <= 80 &&
    EMAIL.test(email.value.trim()),
)

function reset() {
  name.value = ''
  email.value = ''
  role.value = 'viewer'
  result.value = null
  inviting.clear()
}

const inviting = useAction(async () => {
  result.value = await inviteMember(name.value.trim(), email.value.trim(), role.value)
  emit('invited', result.value.invitation)
})

const nameError = computed(() => inviting.fields.value.name)
const emailError = computed(() => {
  const taken = ['email_taken', 'already_invited'].includes(inviting.code.value ?? '')
  return inviting.fields.value.email ?? (taken ? inviting.error.value : null)
})
const formError = computed(() =>
  nameError.value || emailError.value ? null : inviting.error.value,
)

function submit() {
  if (valid.value) void inviting.run()
}

// Each time the dialog opens, it starts from an empty form.
watch(open, (value) => {
  if (value) reset()
})
</script>

<template>
  <AppDialog
    v-model="open"
    :title="result ? 'Invitation ready' : 'Invite someone'"
    :subtitle="
      result
        ? `Send this link to ${result.invitation.name}. It's how they create their account.`
        : 'They choose their own password when they accept.'
    "
    :icon="result ? MailPlus : UserPlus"
    :tone="result ? 'success' : 'primary'"
    :persistent="inviting.busy.value"
    max-width="560"
    fullscreen-on-mobile
  >
    <div v-if="result" data-test="invite-result">
      <CopyField :value="result.link" label="Invitation link" test-id="invite-link" />
      <p class="text-body-small text-medium-emphasis mt-3 mb-0">
        It works once, for {{ result.invitation.email }}, and expires
        {{ formatDateTime(result.invitation.expires_at) }}. Cashcove doesn't send email, so share it
        however you trust, like a text message. You won't be able to see this link again, but you
        can always create a new one.
      </p>
    </div>

    <v-form v-else @submit.prevent="submit">
      <v-text-field
        v-model="name"
        label="Their name"
        autocomplete="off"
        autofocus
        counter="80"
        :rules="nameRules"
        :error-messages="nameError ?? undefined"
        data-test="invite-name"
      />
      <v-text-field
        v-model="email"
        label="Their email"
        type="email"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        hint="They'll sign in with this email."
        persistent-hint
        class="mt-2"
        :rules="emailRules"
        :error-messages="emailError ?? undefined"
        data-test="invite-email"
      />

      <div id="invite-role-label" class="text-label-large mt-6 mb-2">What can they do?</div>
      <v-item-group
        v-model="role"
        mandatory
        class="invite-roles"
        role="radiogroup"
        aria-labelledby="invite-role-label"
      >
        <v-item
          v-for="option in ROLES"
          :key="option.value"
          v-slot="{ isSelected, toggle }"
          :value="option.value"
        >
          <v-card
            :color="isSelected ? 'primary' : undefined"
            :variant="isSelected ? 'tonal' : 'outlined'"
            class="invite-role pa-4"
            role="radio"
            :aria-checked="isSelected"
            :data-test="`invite-role-${option.value}`"
            @click="toggle"
          >
            <div class="d-flex align-center ga-2 mb-1">
              <v-icon :icon="option.icon" size="18" />
              <span class="text-title-small font-weight-bold">{{ option.title }}</span>
              <v-spacer />
              <v-icon v-if="isSelected" :icon="Check" size="18" />
            </div>
            <div class="text-body-small">{{ option.text }}</div>
          </v-card>
        </v-item>
      </v-item-group>

      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="formError"
        data-test="invite-error"
      />
      <!-- Lets Enter submit the form. -->
      <button type="submit" hidden />
    </v-form>

    <template #actions>
      <template v-if="result">
        <v-btn variant="text" data-test="invite-another" @click="reset">Invite someone else</v-btn>
        <v-btn color="primary" variant="flat" data-test="invite-done" @click="open = false">
          Done
        </v-btn>
      </template>
      <template v-else>
        <v-btn variant="text" :disabled="inviting.busy.value" @click="open = false">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="MailPlus"
          :loading="inviting.busy.value"
          :disabled="!valid"
          data-test="invite-submit"
          @click="submit"
        >
          Create invitation link
        </v-btn>
      </template>
    </template>
  </AppDialog>
</template>

<style scoped>
.invite-roles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.invite-role.v-card--variant-outlined {
  border-color: rgba(var(--v-border-color), 0.2);
}
</style>
