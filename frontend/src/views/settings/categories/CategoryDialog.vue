<script setup lang="ts">
import { Pencil, Plus } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import { createCategory, updateCategory, type Category } from '@/api/categories'
import AppDialog from '@/components/ui/AppDialog.vue'
import EmojiPicker from '@/components/ui/EmojiPicker.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useCategoriesStore } from '@/stores/categories'

/** Adds a category to a group, or renames, re-emojis or moves one. */
const open = defineModel<boolean>({ required: true })
const props = withDefaults(
  defineProps<{
    category: Category | null
    /** The group a new category goes in unless changed. */
    groupId?: string | null
  }>(),
  { groupId: null },
)

const store = useCategoriesStore()
const form = reactive<{ emoji: string; name: string; groupId: string | null }>({
  emoji: '🏷️',
  name: '',
  groupId: null,
})
const valid = ref(false)

watch(open, (value) => {
  if (!value) return
  form.emoji = props.category?.emoji ?? '🏷️'
  form.name = props.category?.name ?? ''
  form.groupId = props.category?.group_id ?? props.groupId ?? store.groups[0]?.id ?? null
  saving.clear()
})

const groupItems = computed(() =>
  store.groups.map((group) => ({ value: group.id, title: group.name })),
)

const saving = useAction(async () => {
  const input = { emoji: form.emoji, name: form.name.trim(), group_id: form.groupId as string }
  const saved = props.category
    ? await updateCategory(props.category.id, input)
    : await createCategory(input)
  await store.load()
  notify(props.category ? `Saved ${saved.name}` : `Added ${saved.name}`)
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
  (value: string) => !!value.trim() || 'Enter a name for the category',
  (value: string) => value.trim().length <= 60 || 'Keep it under 60 characters',
]
const groupRules = [(value: string | null) => !!value || 'Choose a group']
const nameError = computed(() =>
  saving.code.value === 'name_taken' ? saving.error.value : saving.fields.value.name,
)
const formError = computed(() => (nameError.value ? null : saving.error.value))
</script>

<template>
  <AppDialog
    v-model="open"
    :title="category ? `Edit ${category.name}` : 'Add a category'"
    :icon="category ? Pencil : Plus"
    :persistent="saving.busy.value"
    max-width="520"
  >
    <v-form v-model="valid" @submit.prevent="submit">
      <div class="d-flex align-start ga-3">
        <EmojiPicker v-model="form.emoji" label="Emoji" />
        <v-text-field
          v-model="form.name"
          label="Name"
          :rules="nameRules"
          :error-messages="nameError ?? undefined"
          autofocus
          data-test="category-name"
        />
      </div>
      <v-select
        v-model="form.groupId"
        :items="groupItems"
        label="Group"
        :rules="groupRules"
        class="mt-2"
        data-test="category-group"
      />

      <v-alert
        v-if="formError"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-2"
        :text="formError"
        data-test="category-error"
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
        data-test="category-save"
        @click="submit"
      >
        {{ category ? 'Save changes' : 'Add category' }}
      </v-btn>
    </template>
  </AppDialog>
</template>
