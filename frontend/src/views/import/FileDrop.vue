<script setup lang="ts">
import { ChevronDown, FileUp, Sparkles, Upload } from '@lucide/vue'
import { ref, useTemplateRef } from 'vue'

import { ACCEPTED_FILES, FILE_FORMATS } from '@/views/import/file'

/** Where a statement file is dropped or chosen, which starts importing it. */
const emit = defineEmits<{ file: [file: File] }>()

const input = useTemplateRef<HTMLInputElement>('input')
const over = ref(false)
const help = ref(false)
// Dragging across the card's own parts leaves one and enters the next.
let depth = 0

function choose() {
  input.value?.click()
}

defineExpose({ choose })

function chosen(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  // So the same file can be chosen again, e.g. after closing its import.
  field.value = ''
  if (file) emit('file', file)
}

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false

function enter(event: DragEvent) {
  if (!carriesFiles(event)) return
  depth += 1
  over.value = true
}

function leave() {
  depth = Math.max(0, depth - 1)
  over.value = depth > 0
}

function drop(event: DragEvent) {
  depth = 0
  over.value = false
  const file = event.dataTransfer?.files[0]
  if (file) emit('file', file)
}
</script>

<template>
  <v-card
    class="file-drop mb-6"
    :class="{ 'file-drop--over': over }"
    :border="false"
    data-test="file-drop"
    @dragenter.prevent="enter"
    @dragover.prevent
    @dragleave="leave"
    @drop.prevent="drop"
  >
    <div class="d-flex flex-column flex-sm-row align-center ga-5 pa-6">
      <div class="file-drop__icon flex-shrink-0">
        <v-icon :icon="FileUp" size="28" />
      </div>
      <div class="flex-grow-1 text-center text-sm-start">
        <h2 class="text-title-medium font-weight-bold ma-0" data-test="file-drop-title">
          {{ over ? 'Drop it to import it' : 'Import a statement file' }}
        </h2>
        <p class="text-body-medium text-medium-emphasis mt-1 mb-0">
          Drop a file from any bank here, or choose one. Nothing is saved until you’ve checked it.
        </p>
        <div class="d-flex flex-wrap justify-center justify-sm-start ga-1 mt-3">
          <v-chip v-for="name in FILE_FORMATS" :key="name" size="x-small" variant="tonal" label>
            {{ name }}
          </v-chip>
          <v-chip
            size="x-small"
            variant="tonal"
            color="primary"
            label
            :prepend-icon="Sparkles"
            data-test="file-format-pdf"
          >
            PDF, read by AI
          </v-chip>
        </div>
      </div>
      <v-btn
        color="primary"
        variant="flat"
        size="large"
        :prepend-icon="Upload"
        class="flex-shrink-0"
        data-test="file-choose"
        @click="choose"
      >
        Choose a file
      </v-btn>
    </div>

    <div class="px-4 pb-3">
      <v-btn
        variant="text"
        size="small"
        :append-icon="ChevronDown"
        class="file-drop__toggle"
        :class="{ 'file-drop__toggle--open': help }"
        :aria-expanded="help"
        aria-controls="file-drop-help"
        data-test="file-help-toggle"
        @click="help = !help"
      >
        Where do I get these files?
      </v-btn>
      <v-expand-transition>
        <div
          v-show="help"
          id="file-drop-help"
          class="file-drop__help text-body-medium px-2 pt-2"
          data-test="file-help"
        >
          <p class="mb-2">
            Sign in to your bank’s website, open the account, and look for Download, Export or
            Statements. Choose the dates you want, then one of these:
          </p>
          <ul class="mb-2">
            <li>
              <strong>Quicken (QFX), Money (OFX) or QuickBooks (QBO)</strong> files carry the
              account’s details and balance, so they need no setup.
            </li>
            <li>
              <strong>CSV</strong> files work from any bank. Cashcove works out what each column
              holds, and remembers it for the bank’s next file. Save an Excel workbook as CSV first.
            </li>
            <li><strong>QIF</strong>, an older Quicken format, works too.</li>
          </ul>
          <p class="mb-2">
            <strong>PDF</strong> statements are read by the AI, so they can only be imported once AI
            is set up in Settings. It takes the transactions off the PDF, with your account numbers,
            names and addresses kept on this computer, and you check them before anything is added.
            A scan or a photo of a statement can’t be read.
          </p>
          <p class="mb-0 text-medium-emphasis">
            Banks keep a year or two online, so importing their files now and then keeps your whole
            history in Cashcove, including accounts connected through Plaid.
          </p>
        </div>
      </v-expand-transition>
    </div>

    <label for="file-drop-input" class="d-sr-only">Statement file to import</label>
    <input
      id="file-drop-input"
      ref="input"
      type="file"
      :accept="ACCEPTED_FILES"
      class="d-none"
      data-test="file-input"
      @change="chosen"
    />
  </v-card>
</template>

<style scoped>
.file-drop {
  border: 2px dashed rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.03);
  transition:
    border-color 0.15s,
    background-color 0.15s;
}

.file-drop--over {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}

.file-drop__icon {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 18px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}

.file-drop__toggle :deep(.v-btn__append) {
  transition: transform 0.2s;
}

.file-drop__toggle--open :deep(.v-btn__append) {
  transform: rotate(180deg);
}

.file-drop__help {
  max-width: 720px;
}

.file-drop__help ul {
  padding-inline-start: 20px;
}

.file-drop__help li + li {
  margin-top: 4px;
}
</style>
