<script setup lang="ts">
import {
  LogOut,
  Monitor,
  MonitorSmartphone,
  MonitorX,
  RefreshCw,
  Smartphone,
  Tablet,
  type LucideIcon,
} from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'

import {
  endOtherSessions,
  endSession,
  fetchSessions,
  type DeviceKind,
  type SignedInSession,
} from '@/api/account'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { confirm, confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { formatShortDate } from '@/utils/format'
import SettingsCard from '@/views/settings/SettingsCard.vue'

/** The browsers signed in to this account, each of which can be signed out from here. */
const emit = defineEmits<{ changed: [] }>()

const ICONS: Record<DeviceKind, LucideIcon> = {
  desktop: Monitor,
  phone: Smartphone,
  tablet: Tablet,
  unknown: MonitorSmartphone,
}

const { xs } = useDisplay()
const sessions = ref<SignedInSession[]>([])
const loaded = ref(false)
const loading = useAction(async () => {
  sessions.value = await fetchSessions()
  loaded.value = true
})
const others = computed(() => sessions.value.filter((session) => !session.current))

function devices(count: number): string {
  return count === 1 ? '1 other device' : `${count} other devices`
}

async function signOut(session: SignedInSession) {
  const done = await confirm({
    title: `Sign out ${session.device}?`,
    text: 'Anyone using Cashcove there will have to sign in again.',
    confirmText: 'Sign out',
    icon: LogOut,
    action: () => endSession(session.id),
  })
  if (!done) return
  sessions.value = sessions.value.filter((item) => item.id !== session.id)
  notify(`Signed out ${session.device}`)
  emit('changed')
}

async function signOutOthers() {
  const done = await confirmAndRun(
    {
      title: 'Sign out everywhere else?',
      text: `You'll stay signed in here. Anyone using Cashcove on ${devices(others.value.length)} will have to sign in again.`,
      confirmText: 'Sign out others',
      tone: 'warning',
      icon: MonitorX,
    },
    endOtherSessions,
  )
  if (!done) return
  sessions.value = sessions.value.filter((item) => item.current)
  notify(`Signed out ${devices(done.result.ended)}`)
  emit('changed')
}

onMounted(() => void loading.run())
</script>

<template>
  <SettingsCard
    id="devices"
    title="Where you're signed in"
    subtitle="Sign out anywhere you don't recognise, or on a device you no longer use."
    :icon="MonitorSmartphone"
  >
    <template #append>
      <v-btn
        :icon="RefreshCw"
        variant="text"
        size="small"
        aria-label="Refresh devices"
        :loading="loading.busy.value"
        data-test="devices-refresh"
        @click="loading.run()"
      />
    </template>

    <v-alert
      v-if="loading.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="loading.error.value"
      data-test="devices-error"
    />
    <v-skeleton-loader
      v-if="!loaded && loading.busy.value"
      type="list-item-avatar-two-line@2"
      data-test="devices-loading"
    />
    <v-list v-else bg-color="transparent" class="pa-0" lines="three">
      <v-list-item
        v-for="session in sessions"
        :key="session.id"
        class="px-0 device"
        data-test="device"
      >
        <template #prepend>
          <v-avatar
            :color="session.current ? 'primary' : undefined"
            variant="tonal"
            rounded="lg"
            size="44"
          >
            <v-icon :icon="ICONS[session.kind]" size="22" />
          </v-avatar>
        </template>
        <v-list-item-title class="d-flex flex-wrap align-center ga-2">
          <span class="font-weight-bold">{{ session.device }}</span>
          <v-chip
            v-if="session.current"
            color="success"
            size="x-small"
            variant="tonal"
            data-test="device-current"
          >
            This device
          </v-chip>
        </v-list-item-title>
        <div class="text-body-small text-medium-emphasis mt-1">
          <template v-if="session.current">Active now</template>
          <template v-else>Active <RelativeTime :value="session.last_seen_at" /></template>
          · Signed in {{ formatShortDate(new Date(session.created_at)) }}
        </div>
        <div class="text-body-small text-medium-emphasis">
          <span v-if="session.ip_address">{{ session.ip_address }}</span>
          <span v-if="session.ip_address && session.remember"> · </span>
          <span v-if="session.remember" data-test="device-remembered">
            Stays signed in for up to 30 days
          </span>
        </div>
        <template v-if="!session.current" #append>
          <!-- Just the icon on phones, where the device details need the room. -->
          <v-btn
            v-if="xs"
            :icon="LogOut"
            variant="text"
            size="small"
            :aria-label="`Sign out ${session.device}`"
            data-test="device-sign-out"
            @click="signOut(session)"
          />
          <v-btn
            v-else
            variant="text"
            size="small"
            :prepend-icon="LogOut"
            :aria-label="`Sign out ${session.device}`"
            data-test="device-sign-out"
            @click="signOut(session)"
          >
            Sign out
          </v-btn>
        </template>
      </v-list-item>
    </v-list>

    <div v-if="others.length" class="d-flex justify-end mt-2">
      <v-btn
        variant="tonal"
        color="warning"
        :prepend-icon="MonitorX"
        data-test="devices-sign-out-others"
        @click="signOutOthers"
      >
        Sign out everywhere else
      </v-btn>
    </div>
  </SettingsCard>
</template>

<style scoped>
.device + .device {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
