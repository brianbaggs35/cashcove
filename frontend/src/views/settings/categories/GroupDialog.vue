<script setup lang="ts">
import { FolderPen, FolderPlus } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import { createGroup, updateGroup, type CategoryGroup, type CategoryKind } from '@/api/categories'
import { categoryKinds } from '@/components/finance/categoryKinds'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useCategoriesStore } from '@/stores/categories'

/** Adds a group of categories, or renames one or changes what kind of money it's for. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ group: CategoryGroup | null }>()

const store = useCategoriesStore()
const form = reactive<{ name: string; kind: CategoryKind }>({ name: '', kind: 'expense' })
const valid = ref(false)

watch(open, (value) => {
  if (!value) return
  form.name = props.group?.name ?? ''
  form.kind = props.group?.kind ?? 'expense'
  saving.clear()
})

const saving = useAction(async () => {
  const input = { name: form.name.trim(), kind: form.kind }
  const saved = props.group ? await updateGroup(props.group.id, input) : await createGroup(input)
  await store.load()
  notify(props.group ? `Saved ${saved.name}` : `Added ${saved.name}`)
  open.value = false
})

// What the API rejected no longer applies once the form changes, so it can be sent again.
watch(form, () => {
  saving.clear()
})

function submit() {
  if (valid.value) void saving.run()
}

const nameRules = [
  (value: string) => !!value.trim() || 'Enter a name for the group',
  (value: string) => value.trim().length <= 60 || 'Keep it under 60 characters',
]
/** A name already in use is about the name, so it shows there. */
const nameError = computed(() =>
  saving.code.value === 'name_taken' ? saving.error.value : saving.fields.value.name,
)
const formError = computed(() => (nameError.value ? null : saving.error.value))
</script>

<template>
  <AppDialog
    v-model="open"
    :title="group ? `Edit ${group.name}` : 'Add a group'"
    subtitle="Groups gather categories, like Food & drink for groceries and restaurants."
    :icon="group ? FolderPen : FolderPlus"
    :persistent="saving.busy.value"
    max-width="560"
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <v-text-field
        v-model="form.name"
        label="Name"
        :rules="nameRules"
        :error-messages="nameError ?? undefined"
        autofocus
        data-test="group-name"
      />

      <v-radio-group
        v-model="form.kind"
        label="What it's for"
        color="primary"
        class="mt-2"
        hide-details
        data-test="group-kind"
      >
        <v-radio
          v-for="kind in categoryKinds"
          :key="kind.value"
          :value="kind.value"
          class="group-kind mb-2"
          :data-test="`group-kind-${kind.value}`"
        >
          <template #label>
            <div class="py-1">
              <div class="text-body-large font-weight-medium text-high-emphasis">
                {{ kind.title }}
              </div>
              <div class="text-body-small text-medium-emphasis">{{ kind.text }}</div>
            </div>
          </template>
        </v-radio>
      </v-radio-group>

      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-4"
        :text="formError"
        data-test="group-error"
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
        data-test="group-save"
        @click="submit"
      >
        {{ group ? 'Save changes' : 'Add group' }}
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.group-kind :deep(.v-label) {
  opacity: 1;
}
</style>
