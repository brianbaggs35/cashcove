<script setup lang="ts">
import { computed } from 'vue'

import type { ImportPreview } from '@/api/imports'
import { useImportsStore } from '@/stores/imports'
import { useImportWizard } from '@/stores/importWizard'
import { formatColumns } from '@/views/import/columns'

/**
 * Which format a CSV file is read with: one of the saved formats, or a new one. It's offered once
 * there is a saved format to choose, and says why one that can't read the file was turned down.
 */
const wizard = useImportWizard()
const imports = useImportsStore()

/** The choice that reads the file as a new format, saved on importing if it's wanted. */
const NEW_FORMAT = 'new'

const preview = computed(() => wizard.preview as ImportPreview)

const items = computed(() => [
  {
    value: NEW_FORMAT,
    title: 'New format',
    subtitle: 'Match the columns here, and save them for the bank’s next file',
  },
  ...imports.formats.map((format) => ({
    value: format.id,
    title: format.name,
    subtitle: formatColumns(format),
  })),
])

/** What the file is read with now, which a format that was turned down doesn't change. */
const chosen = computed(() => imports.findFormat(preview.value.profile_id)?.id ?? NEW_FORMAT)

/** What the file is still read with, now that the format asked for can't read it. */
const stays = computed(() =>
  wizard.profileName
    ? `Still reading with your ${wizard.profileName} format.`
    : 'The columns below are as Cashcove found them. Choose another format, or go on to save them as a new one.',
)

function choose(value: string) {
  void wizard.chooseFormat(value === NEW_FORMAT ? null : value)
}
</script>

<template>
  <div v-if="imports.formats.length" class="mb-4" data-test="format-picker">
    <v-select
      :model-value="chosen"
      :items="items"
      label="Read this file with"
      hide-details
      data-test="format-choice"
      @update:model-value="choose"
    >
      <template #item="{ props: itemProps, item }">
        <v-list-item v-bind="itemProps" :subtitle="item.subtitle" class="format-choice__item" />
      </template>
    </v-select>

    <v-alert
      v-if="wizard.formatProblem"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-3"
      data-test="format-problem"
    >
      <div>{{ wizard.formatProblem }}</div>
      <div class="mt-1">{{ stays }}</div>
      <!-- Under the words, not beside them, which leaves them a few words wide on a phone. -->
      <v-btn
        v-if="wizard.profileName"
        variant="text"
        size="small"
        class="mt-2 ms-n3"
        data-test="format-create-new"
        @click="choose(NEW_FORMAT)"
      >
        Create a new format instead
      </v-btn>
    </v-alert>
  </div>
</template>

<style scoped>
/* The format chosen is tinted, and a subtitle faded by its opacity is too faint to read on it. */
.format-choice__item :deep(.v-list-item-subtitle) {
  opacity: 1;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
