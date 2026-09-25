<script setup lang="ts">
import { Crown, Eye, UserPlus, UserRound, Users } from '@lucide/vue'

import SettingsCard from '@/views/settings/SettingsCard.vue'

const roles = [
  {
    title: 'Owner',
    icon: Crown,
    description: 'Everything, including users, connections and settings.',
  },
  {
    title: 'Member',
    icon: UserRound,
    description: 'Manage accounts, budgets, subscriptions and transactions.',
  },
  { title: 'Viewer', icon: Eye, description: 'See everything, change nothing.' },
]
</script>

<template>
  <SettingsCard
    title="People"
    subtitle="Invite the people you share finances with and choose what they can do."
    :icon="Users"
  >
    <template #append>
      <v-btn color="primary" :prepend-icon="UserPlus" disabled>Invite</v-btn>
    </template>
    <v-empty-state
      :icon="Users"
      headline="Sign-in comes next"
      text="User accounts, invitations and roles arrive with Cashcove's sign-in. The first person to open Cashcove becomes its owner."
      size="64"
      class="py-6"
    />
  </SettingsCard>

  <SettingsCard title="Roles" subtitle="What each role will be able to do.">
    <v-list bg-color="transparent" class="pa-0">
      <v-list-item
        v-for="role in roles"
        :key="role.title"
        :title="role.title"
        :subtitle="role.description"
        class="px-0"
      >
        <template #prepend>
          <v-avatar variant="tonal" color="secondary" rounded="lg" size="36" class="me-1">
            <v-icon :icon="role.icon" size="18" />
          </v-avatar>
        </template>
      </v-list-item>
    </v-list>
  </SettingsCard>
</template>
