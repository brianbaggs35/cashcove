<script setup lang="ts">
import { onMounted, ref } from 'vue'

import TabPage from '@/components/TabPage.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useImportsStore } from '@/stores/imports'
import { useImportWizard } from '@/stores/importWizard'
import FileDrop from '@/views/import/FileDrop.vue'
import ImportDialog from '@/views/import/ImportDialog.vue'
import ImportHistory from '@/views/import/ImportHistory.vue'
import SavedFormats from '@/views/import/SavedFormats.vue'

const auth = useAuthStore()
const store = useImportsStore()
const accounts = useAccountsStore()
const wizard = useImportWizard()

const importing = ref(false)

function start(file: File) {
  void wizard.start(file)
  importing.value = true
}

// Someone else may have imported or undone something since the tab was last open.
onMounted(() => {
  void store.load()
  void accounts.ensureLoaded()
})
</script>

<template>
  <TabPage name="import">
    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      text="You can see what’s been imported and the saved formats. Only an admin can import files or change them."
    />

    <FileDrop v-if="auth.isAdmin" @file="start" />

    <v-alert
      v-if="store.error && !store.loaded"
      type="error"
      variant="tonal"
      :text="`Couldn't load the imports. ${store.error}`"
      data-test="imports-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="imports-retry" @click="store.load()">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-else-if="!store.loaded" data-test="imports-loading">
      <v-skeleton-loader type="list-item-avatar-three-line@3" class="rounded-xl" />
    </div>

    <v-row v-else>
      <v-col cols="12" lg="7">
        <ImportHistory />
      </v-col>
      <v-col cols="12" lg="5">
        <SavedFormats />
      </v-col>
    </v-row>

    <ImportDialog v-if="auth.isAdmin" v-model="importing" />
  </TabPage>
</template>
