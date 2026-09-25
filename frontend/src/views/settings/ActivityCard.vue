<script setup lang="ts">
import { History, RefreshCw } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import type { ActivityEntry } from '@/api/account'
import {
  describeActivity,
  type ActivityDescription,
  type ActivityTone,
  type Perspective,
} from '@/auth/activity'
import { useAction } from '@/composables/useAction'
import { formatDateTime, formatDay, formatTime } from '@/utils/format'
import SettingsCard from '@/views/settings/SettingsCard.vue'

/** Sign-ins and security changes, newest first and grouped by day. */
const props = withDefaults(
  defineProps<{
    title: string
    subtitle: string
    load: () => Promise<ActivityEntry[]>
    perspective?: Perspective
    /** How many entries show before "Show all". */
    initial?: number
  }>(),
  { perspective: 'self', initial: 8 },
)

interface Item extends ActivityDescription {
  entry: ActivityEntry
  meta: string
}

const TONES: Record<ActivityTone, string | undefined> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
  neutral: undefined,
}

const entries = ref<ActivityEntry[]>([])
const loaded = ref(false)
const expanded = ref(false)
const loading = useAction(async () => {
  entries.value = await props.load()
  loaded.value = true
})

const days = computed(() => {
  const all = entries.value
  const shown = expanded.value ? all : all.slice(0, props.initial)
  const groups: { label: string; items: Item[] }[] = []
  for (const entry of shown) {
    const label = formatDay(entry.created_at)
    const meta = [formatTime(entry.created_at), entry.device, entry.ip_address]
    const item = {
      entry,
      ...describeActivity(entry, props.perspective),
      meta: meta.filter(Boolean).join(' · '),
    }
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
})

onMounted(() => void loading.run())
defineExpose({ reload: () => loading.run() })
</script>

<template>
  <SettingsCard :title="title" :subtitle="subtitle" :icon="History">
    <template #append>
      <v-btn
        :icon="RefreshCw"
        variant="text"
        size="small"
        aria-label="Refresh activity"
        :loading="loading.busy.value"
        data-test="activity-refresh"
        @click="loading.run()"
      />
    </template>

    <v-alert
      v-if="loading.error.value"
      type="error"
      variant="tonal"
      density="compact"
      :text="loading.error.value"
      data-test="activity-error"
    />
    <v-skeleton-loader
      v-else-if="!loaded"
      type="list-item-avatar-two-line@3"
      data-test="activity-loading"
    />
    <p v-else-if="!entries.length" class="text-body-medium text-medium-emphasis mb-0">
      Nothing yet. Sign-ins and security changes will show up here.
    </p>
    <template v-else>
      <section v-for="day in days" :key="day.label" class="activity-day" data-test="activity-day">
        <h3 class="text-label-medium text-medium-emphasis font-weight-bold mb-3">
          {{ day.label }}
        </h3>
        <ol class="activity-list">
          <li
            v-for="item in day.items"
            :key="item.entry.id"
            class="activity-item"
            data-test="activity-item"
          >
            <v-avatar :color="TONES[item.tone]" variant="tonal" size="32">
              <v-icon :icon="item.icon" size="16" />
            </v-avatar>
            <div style="min-width: 0">
              <div class="text-body-medium">{{ item.title }}</div>
              <div
                class="text-body-small text-medium-emphasis"
                :title="formatDateTime(item.entry.created_at)"
              >
                {{ item.meta }}
              </div>
            </div>
          </li>
        </ol>
      </section>
      <v-btn
        v-if="entries.length > initial"
        variant="text"
        size="small"
        class="px-2"
        data-test="activity-more"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Show less' : `Show all ${entries.length}` }}
      </v-btn>
    </template>
  </SettingsCard>
</template>

<style scoped>
.activity-day + .activity-day {
  margin-top: 20px;
}

.activity-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.activity-item {
  position: relative;
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 12px;
  padding-bottom: 16px;
}

/* A line joining each event to the next, like a timeline. */
.activity-item:not(:last-child)::before {
  content: '';
  position: absolute;
  inset-inline-start: 15px;
  top: 38px;
  bottom: 6px;
  width: 2px;
  border-radius: 1px;
  background: rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
