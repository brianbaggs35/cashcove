<script setup lang="ts">
import { CircleAlert, CircleCheck, History } from '@lucide/vue'
import { ref, watch } from 'vue'

import { errorMessage } from '@/api/client'
import {
  fetchSyncs,
  type Connection,
  type ConnectionSync,
  type SyncTrigger,
} from '@/api/connections'
import AppDialog from '@/components/ui/AppDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { formatDateTime } from '@/utils/format'
import { syncChanges } from '@/views/connect/actions'

/** A connection's recent syncs: when, why, and what each brought in or why it failed. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ connection: Connection | null }>()

const syncs = ref<ConnectionSync[] | null>(null)
const error = ref<string | null>(null)

const triggers: Record<SyncTrigger, string> = {
  linked: 'After connecting',
  scheduled: 'Scheduled',
  manual: 'Sync now',
  reconnected: 'After reconnecting',
}

async function load(connection: Connection) {
  syncs.value = null
  error.value = null
  try {
    syncs.value = await fetchSyncs(connection.id)
  } catch (loadError) {
    error.value = errorMessage(loadError)
  }
}

watch(open, (value) => {
  if (value && props.connection) void load(props.connection)
})

function seconds(sync: ConnectionSync): string {
  const taken = (new Date(sync.finished_at).getTime() - new Date(sync.started_at).getTime()) / 1000
  return taken < 1 ? 'under a second' : `${Math.round(taken)} s`
}
</script>

<template>
  <AppDialog
    v-model="open"
    :title="connection ? `${connection.institution_name} sync history` : 'Sync history'"
    subtitle="The most recent syncs, newest first."
    :icon="History"
    max-width="560"
    fullscreen-on-mobile
  >
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      :text="`Couldn't load the sync history. ${error}`"
      data-test="sync-history-error"
    >
      <template #append>
        <v-btn variant="text" size="small" @click="connection && load(connection)">Try again</v-btn>
      </template>
    </v-alert>
    <v-skeleton-loader
      v-else-if="!syncs"
      type="list-item-avatar-two-line@3"
      data-test="sync-history-loading"
    />
    <EmptyState
      v-else-if="!syncs.length"
      :icon="History"
      title="No syncs yet"
      text="Syncs show up here once the bank has been checked for new transactions."
      compact
    />
    <v-timeline v-else side="end" density="compact" align="start" truncate-line="both">
      <v-timeline-item
        v-for="sync in syncs"
        :key="sync.id"
        :dot-color="sync.succeeded ? 'success' : 'error'"
        :icon="sync.succeeded ? CircleCheck : CircleAlert"
        size="small"
        data-test="sync-history-item"
      >
        <div class="d-flex align-center flex-wrap ga-2">
          <span class="text-title-small font-weight-bold">{{
            formatDateTime(sync.finished_at)
          }}</span>
          <v-chip size="x-small" variant="tonal">{{ triggers[sync.trigger] }}</v-chip>
        </div>
        <div v-if="sync.succeeded" class="text-body-medium">
          {{ syncChanges(sync) ?? 'Nothing new' }}
          <span class="text-medium-emphasis">· took {{ seconds(sync) }}</span>
        </div>
        <div v-else class="text-body-medium text-error">
          {{ sync.error_message ?? 'The sync failed.' }}
        </div>
      </v-timeline-item>
    </v-timeline>
    <template #actions>
      <v-btn variant="text" @click="open = false">Close</v-btn>
    </template>
  </AppDialog>
</template>
