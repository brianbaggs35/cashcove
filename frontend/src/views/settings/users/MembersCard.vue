<script setup lang="ts">
import {
  Crown,
  EllipsisVertical,
  Eye,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  UserX,
} from '@lucide/vue'
import { computed, ref } from 'vue'

import {
  createResetLink,
  removeMember,
  resetTwoFactor,
  updateMember,
  type Member,
  type MemberChanges,
  type ResetLink,
} from '@/api/users'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import RoleChip from '@/components/ui/RoleChip.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { confirmAndRun, type ConfirmOptions } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useAuthStore } from '@/stores/auth'
import SettingsCard from '@/views/settings/SettingsCard.vue'
import LinkDialog from '@/views/settings/users/LinkDialog.vue'

/** Everyone in the household. Admins can change roles, reset sign-ins and remove people. */
const props = defineProps<{
  members: Member[]
  loaded: boolean
  busy: boolean
  error: string | null
}>()
const emit = defineEmits<{
  invite: []
  retry: []
  updated: [member: Member]
  removed: [member: Member]
}>()

const auth = useAuthStore()

function isYou(member: Member): boolean {
  return member.id === auth.user?.id
}

/** Cashcove always keeps an active admin, so the last one can't step down. */
const onlyAdmin = computed(
  () => props.members.filter((member) => member.role === 'admin' && member.is_active).length < 2,
)

// ---- Role and access ----

async function update(
  member: Member,
  changes: MemberChanges,
  question: Omit<ConfirmOptions, 'action'>,
  success: string,
) {
  const done = await confirmAndRun(question, () => updateMember(member.id, changes))
  if (!done) return
  emit('updated', done.result)
  if (isYou(member)) auth.updateUser({ role: done.result.role })
  notify(success)
}

function makeAdmin(member: Member) {
  return update(
    member,
    { role: 'admin' },
    {
      title: `Make ${member.name} an admin?`,
      text: "They'll be able to change anything in Cashcove, including who has access.",
      confirmText: 'Make admin',
      icon: Crown,
    },
    `${member.name} is now an admin`,
  )
}

function makeViewer(member: Member) {
  const you = isYou(member)
  return update(
    member,
    { role: 'viewer' },
    you
      ? {
          title: 'Stop being an admin?',
          text: "You'll still see everything, but you won't be able to change anything. Only another admin can make you an admin again.",
          confirmText: 'Make me a viewer',
          tone: 'warning',
          icon: Eye,
        }
      : {
          title: `Make ${member.name} a viewer?`,
          text: "They'll still see everything, but won't be able to change anything.",
          confirmText: 'Make viewer',
          icon: Eye,
        },
    you ? "You're now a viewer" : `${member.name} is now a viewer`,
  )
}

function turnOff(member: Member) {
  return update(
    member,
    { is_active: false },
    {
      title: `Turn off ${member.name}'s account?`,
      text: "They'll be signed out everywhere and can't sign in until you turn it back on. Nothing of theirs is deleted.",
      confirmText: 'Turn off account',
      tone: 'warning',
      icon: UserX,
    },
    `${member.name}'s account is off`,
  )
}

function turnOn(member: Member) {
  return update(
    member,
    { is_active: true },
    {
      title: `Turn ${member.name}'s account back on?`,
      text: 'They can sign in again with their password.',
      confirmText: 'Turn back on',
      icon: UserCheck,
    },
    `${member.name} can sign in again`,
  )
}

async function remove(member: Member) {
  const done = await confirmAndRun(
    {
      title: `Remove ${member.name}?`,
      text: "Their account, passkeys and sessions are deleted, and this can't be undone. You can invite them again later.",
      confirmText: 'Remove',
      tone: 'error',
      icon: UserMinus,
    },
    () => removeMember(member.id),
  )
  if (!done) return
  emit('removed', member)
  notify(`Removed ${member.name}`)
}

async function turnOffTwoStep(member: Member) {
  const done = await confirmAndRun(
    {
      title: `Turn off two-step verification for ${member.name}?`,
      text: "Do this if they lost their phone and their recovery codes. They'll sign in with just their password until they set it up again.",
      confirmText: 'Turn it off',
      tone: 'warning',
      icon: ShieldOff,
    },
    () => resetTwoFactor(member.id),
  )
  if (!done || !member.details) return
  emit('updated', { ...member, details: { ...member.details, totp_enabled: false } })
  notify(`Two-step verification is off for ${member.name}`)
}

// ---- Password reset links ----

const reset = ref<{ member: Member; link: ResetLink } | null>(null)
const linkOpen = ref(false)
/** Whose link is being created, so their menu button shows progress. */
const linkFor = ref<string | null>(null)
const creatingLink = useAction(async (member: Member) => {
  reset.value = { member, link: await createResetLink(member.id) }
  linkOpen.value = true
})

async function resetLink(member: Member) {
  linkFor.value = member.id
  await creatingLink.run(member)
  linkFor.value = null
  if (creatingLink.error.value) notify(creatingLink.error.value, 'error')
}
</script>

<template>
  <SettingsCard
    title="People"
    subtitle="Everyone who can sign in to this household's Cashcove."
    :icon="Users"
  >
    <template v-if="auth.isAdmin" #action>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="UserPlus"
        data-test="invite-open"
        @click="emit('invite')"
      >
        Invite
      </v-btn>
    </template>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      :text="error"
      data-test="members-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="members-retry" @click="emit('retry')">
          Try again
        </v-btn>
      </template>
    </v-alert>
    <v-skeleton-loader
      v-else-if="!loaded && busy"
      type="list-item-avatar-two-line@2"
      data-test="members-loading"
    />
    <v-list v-else bg-color="transparent" class="pa-0" lines="three">
      <v-list-item
        v-for="member in members"
        :key="member.id"
        class="px-0 member"
        :class="{ 'member--off': !member.is_active }"
        data-test="member"
      >
        <template #prepend>
          <UserAvatar :name="member.name" size="44" />
        </template>
        <v-list-item-title class="d-flex flex-wrap align-center ga-2">
          <span class="font-weight-bold">{{ member.name }}</span>
          <v-chip v-if="isYou(member)" size="x-small" variant="outlined" data-test="member-you">
            You
          </v-chip>
          <RoleChip :role="member.role" size="x-small" />
          <v-chip
            v-if="!member.is_active"
            color="warning"
            size="x-small"
            variant="tonal"
            :prepend-icon="UserX"
            data-test="member-off"
          >
            Turned off
          </v-chip>
        </v-list-item-title>
        <div class="text-body-small text-medium-emphasis text-truncate">{{ member.email }}</div>
        <div
          v-if="member.details"
          class="d-flex flex-wrap align-center ga-3 text-body-small text-medium-emphasis mt-1"
          data-test="member-details"
        >
          <span class="d-inline-flex align-center ga-1">
            <v-icon :icon="Fingerprint" size="14" />
            {{
              member.details.passkey_count === 0
                ? 'No passkeys'
                : member.details.passkey_count === 1
                  ? '1 passkey'
                  : `${member.details.passkey_count} passkeys`
            }}
          </span>
          <span class="d-inline-flex align-center ga-1">
            <v-icon :icon="member.details.totp_enabled ? ShieldCheck : ShieldOff" size="14" />
            Two-step {{ member.details.totp_enabled ? 'on' : 'off' }}
          </span>
          <span>
            <template v-if="member.details.last_sign_in_at">
              Signed in <RelativeTime :value="member.details.last_sign_in_at" />
            </template>
            <template v-else>Hasn't signed in yet</template>
          </span>
        </div>

        <template v-if="auth.isAdmin" #append>
          <v-menu location="bottom end">
            <template #activator="{ props: activator }">
              <v-btn
                v-bind="activator"
                :icon="EllipsisVertical"
                variant="text"
                size="small"
                :loading="linkFor === member.id"
                :aria-label="`Actions for ${member.name}`"
                data-test="member-actions"
              />
            </template>
            <v-list density="compact" nav min-width="260">
              <template v-if="isYou(member)">
                <v-list-item
                  :prepend-icon="ShieldCheck"
                  title="Your sign-in and security"
                  to="/settings/security"
                  data-test="member-own-security"
                />
                <v-list-item
                  :prepend-icon="Eye"
                  title="Stop being an admin"
                  :subtitle="onlyAdmin ? 'Make someone else an admin first' : undefined"
                  :disabled="onlyAdmin"
                  data-test="member-step-down"
                  @click="makeViewer(member)"
                />
              </template>
              <template v-else>
                <v-list-item
                  v-if="member.role === 'viewer'"
                  :prepend-icon="Crown"
                  title="Make admin"
                  data-test="member-make-admin"
                  @click="makeAdmin(member)"
                />
                <v-list-item
                  v-else
                  :prepend-icon="Eye"
                  title="Make viewer"
                  data-test="member-make-viewer"
                  @click="makeViewer(member)"
                />
                <v-list-item
                  v-if="member.is_active"
                  :prepend-icon="KeyRound"
                  title="Create a password reset link"
                  data-test="member-reset-link"
                  @click="resetLink(member)"
                />
                <v-list-item
                  v-if="member.details?.totp_enabled"
                  :prepend-icon="ShieldOff"
                  title="Turn off two-step verification"
                  data-test="member-reset-two-step"
                  @click="turnOffTwoStep(member)"
                />
                <v-divider class="my-1" />
                <v-list-item
                  v-if="member.is_active"
                  :prepend-icon="UserX"
                  title="Turn off account"
                  data-test="member-turn-off"
                  @click="turnOff(member)"
                />
                <v-list-item
                  v-else
                  :prepend-icon="UserCheck"
                  title="Turn account back on"
                  data-test="member-turn-on"
                  @click="turnOn(member)"
                />
                <v-list-item
                  :prepend-icon="UserMinus"
                  title="Remove from household"
                  base-color="error"
                  data-test="member-remove"
                  @click="remove(member)"
                />
              </template>
            </v-list>
          </v-menu>
        </template>
      </v-list-item>
    </v-list>
  </SettingsCard>

  <LinkDialog
    v-if="reset"
    v-model="linkOpen"
    :title="`Password reset link for ${reset.member.name}`"
    :text="`Send this link to ${reset.member.name}. It lets them choose a new password, and any earlier reset link stops working.`"
    :link="reset.link.link"
    :expires-at="reset.link.expires_at"
    :icon="KeyRound"
  />
</template>

<style scoped>
.member + .member {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.member--off :deep(.user-avatar) {
  filter: grayscale(1);
  opacity: 0.6;
}
</style>
