<script setup lang="ts">
import { Ban, EllipsisVertical, Link2, MailPlus } from '@lucide/vue'
import { ref } from 'vue'

import {
  renewInvitation,
  revokeInvitation,
  type Invitation,
  type InvitationLink,
} from '@/api/users'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import RoleChip from '@/components/ui/RoleChip.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import SettingsCard from '@/views/settings/SettingsCard.vue'
import LinkDialog from '@/views/settings/users/LinkDialog.vue'

/** Invitations nobody has accepted yet, each with a fresh link or a way to cancel it. */
defineProps<{ invitations: Invitation[] }>()
const emit = defineEmits<{ renewed: [invitation: Invitation]; revoked: [invitation: Invitation] }>()

function expired(invitation: Invitation): boolean {
  return Date.parse(invitation.expires_at) <= Date.now()
}

const renewed = ref<InvitationLink | null>(null)
const linkOpen = ref(false)
const renewingId = ref<string | null>(null)
const renewing = useAction(async (invitation: Invitation) => {
  renewed.value = await renewInvitation(invitation.id)
  linkOpen.value = true
  emit('renewed', renewed.value.invitation)
})

async function renew(invitation: Invitation) {
  renewingId.value = invitation.id
  await renewing.run(invitation)
  renewingId.value = null
  if (renewing.error.value) notify(renewing.error.value, 'error')
}

async function revoke(invitation: Invitation) {
  const done = await confirmAndRun(
    {
      title: `Cancel ${invitation.name}'s invitation?`,
      text: 'Their link stops working. You can invite them again later.',
      confirmText: 'Cancel invitation',
      cancelText: 'Keep it',
      tone: 'error',
      icon: Ban,
    },
    () => revokeInvitation(invitation.id),
  )
  if (!done) return
  emit('revoked', invitation)
  notify(`Cancelled ${invitation.name}'s invitation`)
}
</script>

<template>
  <SettingsCard
    title="Invitations"
    subtitle="Waiting for someone to accept. Links last a week; make a new one if it expires or goes astray."
    :icon="MailPlus"
  >
    <v-list bg-color="transparent" class="pa-0" lines="three">
      <v-list-item
        v-for="invitation in invitations"
        :key="invitation.id"
        class="px-0 invitation"
        data-test="invitation"
      >
        <template #prepend>
          <v-avatar variant="tonal" color="secondary" size="44">
            <v-icon :icon="MailPlus" size="20" />
          </v-avatar>
        </template>
        <v-list-item-title class="d-flex flex-wrap align-center ga-2">
          <span class="font-weight-bold">{{ invitation.name }}</span>
          <RoleChip :role="invitation.role" size="x-small" />
          <v-chip
            v-if="expired(invitation)"
            color="warning"
            size="x-small"
            variant="tonal"
            data-test="invitation-expired"
          >
            Expired
          </v-chip>
        </v-list-item-title>
        <div class="text-body-small text-medium-emphasis text-truncate">
          {{ invitation.email }}
        </div>
        <div class="text-body-small text-medium-emphasis mt-1">
          <template v-if="invitation.invited_by"
            >Invited by {{ invitation.invited_by }} ·
          </template>
          {{ expired(invitation) ? 'Expired' : 'Expires' }}
          <RelativeTime :value="invitation.expires_at" />
        </div>
        <template #append>
          <v-menu location="bottom end">
            <template #activator="{ props: activator }">
              <v-btn
                v-bind="activator"
                :icon="EllipsisVertical"
                variant="text"
                size="small"
                :loading="renewingId === invitation.id"
                :aria-label="`Actions for ${invitation.name}'s invitation`"
                data-test="invitation-actions"
              />
            </template>
            <v-list density="compact" nav min-width="240">
              <v-list-item
                :prepend-icon="Link2"
                title="Create a new link"
                data-test="invitation-renew"
                @click="renew(invitation)"
              />
              <v-list-item
                :prepend-icon="Ban"
                title="Cancel invitation"
                base-color="error"
                data-test="invitation-revoke"
                @click="revoke(invitation)"
              />
            </v-list>
          </v-menu>
        </template>
      </v-list-item>
    </v-list>
  </SettingsCard>

  <LinkDialog
    v-if="renewed"
    v-model="linkOpen"
    :title="`New invitation link for ${renewed.invitation.name}`"
    :text="`Send this link to ${renewed.invitation.name}. Their earlier link no longer works.`"
    :link="renewed.link"
    :expires-at="renewed.invitation.expires_at"
    :icon="MailPlus"
  />
</template>

<style scoped>
.invitation + .invitation {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
