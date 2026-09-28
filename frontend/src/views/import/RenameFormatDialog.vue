<script setup lang="ts">
import { Pencil } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { renameSavedFormat, type SavedFormat } from '@/api/imports'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useImportsStore } from '@/stores/imports'

/** Gives a saved format a name that says which bank's files it reads. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ format: SavedFormat | null }>()

const store = useImportsStore()
const name = ref('')
const valid = ref(false)

watch(open, (value) => {
  if (!value) return
  name.value = props.format?.name ?? ''
  saving.clear()
})

const saving = useAction(async () => {
  const saved = await renameSavedFormat((props.format as SavedFormat).id, name.value.trim())
  store.putFormat(saved)
  notify(`Renamed it ${saved.name}`)
  open.value = false
})

watch(name, () => {
  saving.clear()
})

function submit() {
  if (valid.value) void saving.run()
}

const rules = [
  (value: string) => value.trim().length > 0 || 'Give it a name',
  (value: string) => value.trim().length <= 80 || 'Keep it under 80 characters',
]
/** Another saved format has the name, or it isn't one. */
const nameError = computed(() =>
  saving.code.value === 'name_taken' ? saving.error.value : saving.fields.value.name,
)
const formError = computed(() => (nameError.value ? null : saving.error.value))
</script>

<template>
  <AppDialog
    v-model="open"
    title="Rename saved format"
    subtitle="A name that says whose files it reads, like the bank and the account."
    :icon="Pencil"
    :persistent="saving.busy.value"
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <v-text-field
        v-model="name"
        label="Name"
        autocomplete="off"
        autofocus
        counter="80"
        :rules="rules"
        :error-messages="nameError ?? undefined"
        data-test="format-name-field"
      />
      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-2"
        :text="formError"
        data-test="format-rename-error"
      />
      <!-- Lets Enter submit the form. -->
      <button type="submit" hidden />
    </v-form>
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!valid"
        data-test="format-rename-save"
        @click="submit"
      >
        Rename
      </v-btn>
    </template>
  </AppDialog>
</template>
