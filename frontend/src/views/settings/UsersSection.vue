<script setup lang="ts">
import { Crown, Eye, ShieldCheck } from '@lucide/vue'
import { onMounted, ref, useTemplateRef } from 'vue'

import {
  fetchHouseholdActivity,
  fetchInvitations,
  fetchMembers,
  type Invitation,
  type Member,
} from '@/api/users'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { useAction } from '@/composables/useAction'
import { useAuthStore } from '@/stores/auth'
import ActivityCard from '@/views/settings/ActivityCard.vue'
import SettingsCard from '@/views/settings/SettingsCard.vue'
import InvitationsCard from '@/views/settings/users/InvitationsCard.vue'
import InviteDialog from '@/views/settings/users/InviteDialog.vue'
import MembersCard from '@/views/settings/users/MembersCard.vue'

const auth = useAuthStore()
const activity = useTemplateRef('activity')

const members = ref<Member[]>([])
const invitations = ref<Invitation[]>([])
const loaded = ref(false)
const inviting = ref(false)

const loading = useAction(async () => {
  const [people, pending] = await Promise.all([
    fetchMembers(),
    auth.isAdmin ? fetchInvitations() : [],
  ])
  members.value = people
  invitations.value = pending
  loaded.value = true
})

/** Every change to the household is logged, so the activity below picks it up. */
function changed() {
  void activity.value?.reload()
}

function memberUpdated(member: Member) {
  members.value = members.value.map((item) => (item.id === member.id ? member : item))
  changed()
}

function memberRemoved(member: Member) {
  members.value = members.value.filter((item) => item.id !== member.id)
  changed()
}

function invited(invitation: Invitation) {
  invitations.value = [invitation, ...invitations.value]
  changed()
}

function invitationRenewed(invitation: Invitation) {
  invitations.value = invitations.value.map((item) =>
    item.id === invitation.id ? invitation : item,
  )
  changed()
}

function invitationRevoked(invitation: Invitation) {
  invitations.value = invitations.value.filter((item) => item.id !== invitation.id)
  changed()
}

const roles = [
  {
    title: 'Admin',
    icon: Crown,
    color: 'primary',
    text: 'Everything: accounts, budgets, bank connections, household settings, and who has access.',
  },
  {
    title: 'Viewer',
    icon: Eye,
    color: 'secondary',
    text: 'Sees everything and changes nothing. Good for a partner or an accountant who just needs to look.',
  },
]

onMounted(() => void loading.run())
</script>

<template>
  <ReadOnlyNotice
    v-if="!auth.isAdmin"
    text="You can see who's in your household. Only an admin can invite people or change what they can do."
  />

  <MembersCard
    :members="members"
    :loaded="loaded"
    :busy="loading.busy.value"
    :error="loading.error.value"
    @invite="inviting = true"
    @retry="loading.run()"
    @updated="memberUpdated"
    @removed="memberRemoved"
  />

  <InvitationsCard
    v-if="auth.isAdmin && invitations.length"
    :invitations="invitations"
    @renewed="invitationRenewed"
    @revoked="invitationRevoked"
  />

  <SettingsCard
    title="Roles"
    subtitle="Cashcove keeps it simple: two roles, and one household per install."
    :icon="ShieldCheck"
  >
    <div class="roles">
      <div v-for="role in roles" :key="role.title" class="role d-flex ga-3 pa-4">
        <v-avatar :color="role.color" variant="tonal" rounded="lg" size="40">
          <v-icon :icon="role.icon" size="20" />
        </v-avatar>
        <div>
          <div class="text-title-small font-weight-bold">{{ role.title }}</div>
          <div class="text-body-small text-medium-emphasis">{{ role.text }}</div>
        </div>
      </div>
    </div>
    <p class="text-body-small text-medium-emphasis mt-4 mb-0">
      Everyone manages their own password, passkeys and two-step verification, whatever their role.
      Cashcove always keeps at least one admin.
    </p>
  </SettingsCard>

  <ActivityCard
    v-if="auth.isAdmin"
    ref="activity"
    title="Household activity"
    subtitle="Sign-ins, failed attempts and account changes for everyone in the household."
    perspective="household"
    :load="fetchHouseholdActivity"
  />

  <InviteDialog v-if="auth.isAdmin" v-model="inviting" @invited="invited" />
</template>

<style scoped>
.roles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.role {
  border-radius: 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
