<script setup lang="ts">
import { LogOut, ShieldCheck, UserRound } from '@lucide/vue'

import RoleChip from '@/components/ui/RoleChip.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <v-menu v-if="auth.user" location="bottom end" offset="8">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        icon
        variant="text"
        class="me-2"
        :aria-label="`Account menu for ${auth.user.name}`"
        data-test="user-menu"
      >
        <UserAvatar :name="auth.user.name" size="36" />
      </v-btn>
    </template>
    <v-card min-width="280" class="py-2">
      <div class="d-flex align-center ga-3 px-4 py-3">
        <UserAvatar :name="auth.user.name" size="44" />
        <div style="min-width: 0">
          <div class="text-title-small font-weight-bold text-truncate">{{ auth.user.name }}</div>
          <div class="text-body-small text-medium-emphasis text-truncate">
            {{ auth.user.email }}
          </div>
          <RoleChip :role="auth.user.role" size="x-small" class="mt-1" />
        </div>
      </div>
      <v-divider class="my-1" />
      <v-list tag="ul" density="compact" nav class="py-0 px-2">
        <li>
          <v-list-item
            :prepend-icon="UserRound"
            title="Your account"
            to="/settings/account"
            rounded="lg"
            data-test="menu-account"
          />
        </li>
        <li>
          <v-list-item
            :prepend-icon="ShieldCheck"
            title="Sign-in and security"
            to="/settings/security"
            rounded="lg"
            data-test="menu-security"
          />
        </li>
      </v-list>
      <v-divider class="my-1" />
      <v-list density="compact" nav class="py-0 px-2">
        <v-list-item
          :prepend-icon="LogOut"
          title="Sign out"
          rounded="lg"
          data-test="menu-sign-out"
          @click="auth.signOut()"
        />
      </v-list>
    </v-card>
  </v-menu>
</template>
