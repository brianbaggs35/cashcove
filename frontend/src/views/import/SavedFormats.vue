<script setup lang="ts">
import { BookmarkCheck, EllipsisVertical, FileSpreadsheet, Pencil, Trash2 } from '@lucide/vue'
import { ref } from 'vue'

import { deleteSavedFormat, type SavedFormat } from '@/api/imports'
import EmptyState from '@/components/ui/EmptyState.vue'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useImportsStore } from '@/stores/imports'
import RenameFormatDialog from '@/views/import/RenameFormatDialog.vue'

/** How banks' CSV files are laid out, remembered so their next files read the same way. */
const auth = useAuthStore()
const store = useImportsStore()
const accounts = useAccountsStore()

const renaming = ref<SavedFormat | null>(null)
const renameOpen = ref(false)

function columns(format: SavedFormat): string {
  return format.headers.length ? format.headers.join(' · ') : 'Files without column names'
}

/** The account it was last used for, if it's still there. */
const usedFor = (format: SavedFormat) => accounts.find(format.account_id)?.name ?? null

function rename(format: SavedFormat) {
  renaming.value = format
  renameOpen.value = true
}

async function remove(format: SavedFormat) {
  const done = await confirmAndRun(
    {
      title: `Delete the ${format.name} format?`,
      text: 'The next file with these columns is read from scratch. Files already imported with it stay as they are.',
      confirmText: 'Delete format',
      tone: 'error',
      icon: Trash2,
    },
    () => deleteSavedFormat(format.id),
  )
  if (!done) return
  store.removeFormat(format.id)
  notify(`Deleted the ${format.name} format`)
}
</script>

<template>
  <v-card class="saved-formats mb-6" data-test="saved-formats">
    <div class="px-5 pt-4 pb-2">
      <div class="d-flex align-center flex-wrap ga-2">
        <h2 class="text-title-medium font-weight-bold ma-0">Saved formats</h2>
        <v-chip v-if="store.formats.length" size="x-small" variant="tonal">
          {{ store.formats.length }}
        </v-chip>
      </div>
      <p v-if="store.formats.length" class="text-body-small text-medium-emphasis mt-1 mb-0">
        A bank’s next CSV file with the same columns is read the way its last one was.
      </p>
    </div>

    <EmptyState
      v-if="!store.formats.length"
      :icon="BookmarkCheck"
      title="No saved formats yet"
      text="When you import a CSV file, Cashcove remembers how its columns were read, and reads the bank’s next file the same way."
      compact
    />

    <div v-else class="px-2 pb-2">
      <div
        v-for="format in store.formats"
        :key="format.id"
        class="saved-formats__item d-flex align-start ga-4 py-3 px-3"
        data-test="saved-format"
      >
        <v-avatar color="secondary" variant="tonal" rounded="lg" size="40" class="flex-shrink-0">
          <v-icon :icon="FileSpreadsheet" size="20" />
        </v-avatar>
        <div class="flex-grow-1" style="min-width: 0">
          <div class="text-title-small font-weight-bold text-break" data-test="saved-format-name">
            {{ format.name }}
          </div>
          <div class="saved-formats__columns text-body-small" data-test="saved-format-columns">
            {{ columns(format) }}
          </div>
          <div class="text-body-small text-medium-emphasis mt-1" data-test="saved-format-used">
            <template v-if="format.last_used_at">
              Last used <RelativeTime :value="format.last_used_at" />
              <template v-if="usedFor(format)"> for {{ usedFor(format) }}</template>
            </template>
            <template v-else>Not used yet</template>
          </div>
        </div>
        <v-menu v-if="auth.isAdmin" location="bottom end">
          <template #activator="{ props: activator }">
            <v-btn
              v-bind="activator"
              :icon="EllipsisVertical"
              variant="text"
              size="small"
              class="mt-n1 me-n1"
              :aria-label="`Actions for ${format.name}`"
              data-test="saved-format-actions"
            />
          </template>
          <v-list density="compact" nav min-width="200">
            <v-list-item
              :prepend-icon="Pencil"
              title="Rename"
              data-test="saved-format-rename"
              @click="rename(format)"
            />
            <v-list-item
              :prepend-icon="Trash2"
              title="Delete"
              base-color="error"
              data-test="saved-format-delete"
              @click="remove(format)"
            />
          </v-list>
        </v-menu>
      </div>
    </div>

    <RenameFormatDialog v-if="auth.isAdmin" v-model="renameOpen" :format="renaming" />
  </v-card>
</template>

<style scoped>
.saved-formats__item + .saved-formats__item {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.saved-formats__columns {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
</style>
