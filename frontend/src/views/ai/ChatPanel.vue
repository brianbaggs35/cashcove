<script setup lang="ts">
import { Eraser, FileText, FileUp, Paperclip, SendHorizontal, Sparkles, Upload } from '@lucide/vue'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

import type { StatementReading } from '@/api/ai'
import { useAccountsStore } from '@/stores/accounts'
import { MAX_LENGTH, useAiChat, type StatementMessage } from '@/stores/aiChat'
import { useAuthStore } from '@/stores/auth'
import { useImportWizard } from '@/stores/importWizard'
import AiPrivacyNotice from '@/views/ai/AiPrivacyNotice.vue'
import AiText from '@/views/ai/AiText.vue'
import StatementCard from '@/views/ai/StatementCard.vue'
import ImportDialog from '@/views/import/ImportDialog.vue'
import { isPdf } from '@/views/import/statement'

/**
 * Asking the AI about the household's money, and giving it a PDF statement to read. It answers
 * from a fresh summary of the records (totals, budgets, bills and the latest transactions) that
 * has no account in it, and reads a statement into transactions that are checked before they're
 * imported. Both say what they're doing while the AI works.
 */
const chat = useAiChat()
const auth = useAuthStore()
const accounts = useAccountsStore()
const wizard = useImportWizard()
const draft = ref('')
const end = ref<HTMLElement | null>(null)
const picker = useTemplateRef<HTMLInputElement>('picker')
/** Something attached that can't be read here, and where to go instead. */
const problem = ref<string | null>(null)
/** The statement being opened for review, and the dialog it opens in. */
const importing = ref(false)
const opening = ref(false)
const opened = ref<number | null>(null)
/** A file is being dragged over the conversation. */
const over = ref(false)
// Dragging across the card's own parts leaves one and enters the next.
let depth = 0

const questions = [
  'How much did I spend on groceries last month?',
  'What were my biggest expenses this month?',
  'Which subscriptions and bills cost the most?',
  'How am I doing against my budgets?',
  'Where could I cut back?',
]

const tooLong = computed(() => draft.value.length > MAX_LENGTH)
const canSend = computed(() => !!draft.value.trim() && !tooLong.value && !chat.busy)

/** A suggested question is asked as it is, and leaves whatever is being typed alone. */
function ask(text: string) {
  void chat.send(text)
}

function submit() {
  if (canSend.value) {
    const text = draft.value
    // The box clears at once, so it can take the next question while this one is answered.
    draft.value = ''
    void chat.send(text).then((sent) => {
      if (!sent && !draft.value) draft.value = text
    })
  }
}

const NOT_A_PDF =
  'Only a PDF statement can be read here. A CSV, OFX, QFX or QIF file goes through the Import tab.'

/** A file's size the way people say it: 240 KB, or 1.2 MB. */
function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function choose() {
  picker.value?.click()
}

/** Has the AI read a PDF that was chosen or dropped, or says why not. */
function attach(file: File) {
  problem.value = null
  if (!isPdf(file)) {
    problem.value = NOT_A_PDF
    return
  }
  void chat.attach(file)
}

function chosen(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  // So the same file can be chosen again.
  field.value = ''
  if (file) attach(file)
}

/** Whether a drag is carrying a file, which only an admin who isn't waiting on the AI can use. */
const accepts = (event: DragEvent) =>
  auth.isAdmin && !chat.busy && (event.dataTransfer?.types.includes('Files') ?? false)

function enter(event: DragEvent) {
  if (!accepts(event)) return
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
  if (file && auth.isAdmin && !chat.busy) attach(file)
}

/** Opens what the AI found for review, once the preview of it is ready. */
async function review(message: StatementMessage) {
  opening.value = true
  opened.value = message.id
  try {
    await wizard.openReading(message.file.name, message.reading as StatementReading)
  } finally {
    opening.value = false
  }
  importing.value = true
}

function chooseAgain() {
  importing.value = false
  choose()
}

// Once a statement's transactions are imported, its card says so.
watch(
  () => wizard.record,
  (record) => {
    if (record && opened.value !== null) chat.imported(opened.value, record)
  },
)

onMounted(() => void accounts.ensureLoaded())

// Whatever is added, the newest is in view, and so is a statement as it finishes.
watch(
  () => [
    chat.messages.length,
    chat.busy,
    chat.error,
    chat.messages.map((message) => (message.kind === 'statement' ? message.status : '')).join(),
  ],
  async () => {
    await nextTick()
    end.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  },
)
</script>

<template>
  <section aria-label="Ask the AI" data-test="ai-chat">
    <AiPrivacyNotice class="mb-4" />

    <v-alert
      v-if="problem"
      type="warning"
      variant="tonal"
      density="compact"
      closable
      class="mb-4"
      data-test="chat-attach-problem"
      @click:close="problem = null"
    >
      {{ problem }}
      <template #append>
        <v-btn to="/import" variant="text" size="small" data-test="chat-attach-import">
          Go to Import
        </v-btn>
      </template>
    </v-alert>

    <v-card
      class="chat__card"
      :class="{ 'chat__card--over': over }"
      data-test="chat-card"
      @dragenter.prevent="enter"
      @dragover.prevent
      @dragleave="leave"
      @drop.prevent="drop"
    >
      <div
        v-if="over"
        class="chat__drop d-flex flex-column align-center justify-center ga-2"
        data-test="chat-drop"
      >
        <v-icon :icon="FileUp" size="36" />
        <p class="text-title-medium font-weight-bold ma-0">Drop a PDF statement to read it</p>
      </div>
      <div class="d-flex align-center ga-2 px-5 pt-4">
        <h2 class="text-title-medium font-weight-bold ma-0 flex-grow-1">Your conversation</h2>
        <v-btn
          variant="text"
          size="small"
          :prepend-icon="Eraser"
          :disabled="!chat.messages.length || chat.busy"
          data-test="chat-clear"
          @click="chat.clear()"
        >
          New chat
        </v-btn>
      </div>

      <div
        class="chat__log pa-5"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
        data-test="chat-log"
      >
        <div v-if="!chat.messages.length" class="chat__welcome" data-test="chat-welcome">
          <div class="chat__mark mb-3"><v-icon :icon="Sparkles" size="24" /></div>
          <p class="text-title-medium font-weight-bold mb-1">Ask about your money</p>
          <p class="text-body-medium text-medium-emphasis mb-4">
            Your spending, income, budgets, subscriptions and bills. The answers come from your own
            records, and they explain what the numbers show. They aren’t financial advice.
          </p>
          <!-- On a narrow screen the offer comes first, where the questions are long enough to
               push it out of sight; on a wide one it's beside them. -->
          <div class="d-flex flex-column flex-lg-row ga-6">
            <div class="flex-lg-grow-1 order-last order-lg-first">
              <p class="text-label-large text-medium-emphasis mb-2">Try asking</p>
              <div class="d-flex flex-wrap ga-2">
                <v-chip
                  v-for="question in questions"
                  :key="question"
                  variant="outlined"
                  color="primary"
                  size="default"
                  class="chat__question"
                  :disabled="chat.busy"
                  data-test="chat-question"
                  @click="ask(question)"
                >
                  {{ question }}
                </v-chip>
              </div>
            </div>

            <v-sheet
              border
              rounded="lg"
              class="chat__statement d-flex flex-column flex-sm-row flex-lg-column align-sm-center align-lg-stretch ga-4 pa-4 order-first order-lg-last"
              data-test="chat-statement-offer"
            >
              <div class="d-flex align-start ga-3 flex-grow-1">
                <v-avatar
                  color="primary"
                  variant="tonal"
                  rounded="lg"
                  size="44"
                  class="flex-shrink-0"
                >
                  <v-icon :icon="FileText" size="22" />
                </v-avatar>
                <div>
                  <p class="text-title-small font-weight-bold mb-1">Read a bank statement</p>
                  <p class="text-body-small text-medium-emphasis mb-0">
                    Choose a PDF, or drop one here. The AI takes the transactions off it, and you
                    check them and choose the account before anything is added. Your account
                    numbers, name and address stay on this computer.
                  </p>
                </div>
              </div>
              <v-btn
                v-if="auth.isAdmin"
                color="primary"
                variant="flat"
                :prepend-icon="Upload"
                :disabled="chat.busy"
                class="flex-shrink-0"
                data-test="chat-statement-choose"
                @click="choose"
              >
                Choose a PDF
              </v-btn>
              <p
                v-else
                class="text-body-small text-medium-emphasis mb-0"
                data-test="chat-statement-viewer"
              >
                Only an admin can import a statement.
              </p>
            </v-sheet>
          </div>
        </div>

        <div
          v-for="message in chat.messages"
          :key="message.id"
          class="chat__row"
          :class="`chat__row--${message.role}`"
          data-test="chat-message"
        >
          <v-avatar v-if="message.role === 'assistant'" size="32" class="chat__avatar">
            <v-icon :icon="Sparkles" size="18" />
          </v-avatar>
          <div class="chat__bubble">
            <span class="d-sr-only">{{ message.role === 'user' ? 'You' : 'The AI' }}:</span>
            <template v-if="message.kind === 'text'">
              <p v-if="message.role === 'user'" class="chat__plain ma-0 text-body-medium">
                {{ message.content }}
              </p>
              <AiText v-else :text="message.content" />
            </template>
            <v-chip
              v-else-if="message.kind === 'file'"
              :prepend-icon="FileText"
              variant="text"
              color="primary"
              class="chat__file"
              data-test="chat-file-chip"
            >
              {{ message.name }} · {{ fileSize(message.size) }}
            </v-chip>
            <StatementCard
              v-else
              :message="message"
              :opening="opening && opened === message.id"
              @review="review(message)"
              @reread="chat.reread(message)"
              @cancel="chat.cancel()"
            />
          </div>
        </div>

        <div
          v-if="chat.busy && !chat.reading"
          class="chat__row chat__row--assistant"
          data-test="chat-busy"
        >
          <v-avatar size="32" class="chat__avatar"><v-icon :icon="Sparkles" size="18" /></v-avatar>
          <div class="chat__bubble d-flex align-center ga-3">
            <v-progress-circular
              indeterminate
              size="18"
              width="2"
              color="primary"
              aria-hidden="true"
            />
            <output class="text-body-medium text-medium-emphasis">Looking at your records…</output>
          </div>
        </div>

        <v-alert
          v-if="chat.error"
          :type="chat.code === 'ai_blocked' ? 'warning' : 'error'"
          variant="tonal"
          density="compact"
          :text="chat.error"
          data-test="chat-error"
        >
          <template v-if="chat.code !== 'ai_blocked'" #append>
            <v-btn
              variant="text"
              size="small"
              :disabled="chat.busy"
              data-test="chat-retry"
              @click="chat.retry()"
            >
              Try again
            </v-btn>
          </template>
        </v-alert>
        <div ref="end" />
      </div>
    </v-card>

    <form class="chat__composer mt-4" data-test="chat-form" @submit.prevent="submit">
      <v-textarea
        v-model="draft"
        label="Ask a question"
        rows="1"
        max-rows="6"
        auto-grow
        hide-details="auto"
        variant="outlined"
        density="comfortable"
        :error-messages="
          tooLong ? `Keep it under ${MAX_LENGTH.toLocaleString('en-US')} characters` : undefined
        "
        data-test="chat-input"
        @keydown.enter.exact.prevent="submit"
      >
        <template v-if="auth.isAdmin" #prepend-inner>
          <v-btn
            :icon="Paperclip"
            variant="text"
            size="small"
            aria-label="Attach a PDF statement"
            :disabled="chat.busy"
            data-test="chat-attach"
            @click="choose"
          />
        </template>
        <template #append-inner>
          <!-- A field cancels the default action of a click inside it, a submit button's too, so
               the button sends the question itself. -->
          <v-btn
            :icon="SendHorizontal"
            color="primary"
            variant="flat"
            size="small"
            aria-label="Send"
            :disabled="!canSend"
            data-test="chat-send"
            @click="submit"
          />
        </template>
      </v-textarea>
    </form>

    <label for="chat-file" class="d-sr-only">PDF statement to read</label>
    <input
      id="chat-file"
      ref="picker"
      type="file"
      accept=".pdf,application/pdf"
      class="d-none"
      data-test="chat-file"
      @change="chosen"
    />

    <ImportDialog v-if="auth.isAdmin" v-model="importing" @choose-file="chooseAgain" />
  </section>
</template>

<style scoped>
.chat__card {
  position: relative;
  border: 2px solid transparent;
  transition: border-color 0.15s;
}

.chat__card--over {
  border-color: rgb(var(--v-theme-primary));
}

/* Covers the conversation while a file is over it, and says what dropping does. */
.chat__drop {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-surface), 0.9);
  border-radius: inherit;
}

.chat__statement {
  background: rgba(var(--v-theme-primary), 0.04);
}

/* Beside the questions on a wide screen, as a card of its own. */
@media (min-width: 1280px) {
  .chat__statement {
    flex: 0 0 320px;
  }
}

.chat__file {
  max-width: 100%;
}

.chat__log {
  display: grid;
  gap: 16px;
  min-height: 280px;
}

.chat__mark {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
}

/* A phone has no room for it: the offer to read a statement is worth more of the first screen. */
@media (max-width: 599.98px) {
  .chat__mark {
    display: none;
  }
}

.chat__question {
  height: auto;
  min-height: 32px;
  padding-block: 4px;
  white-space: normal;
}

.chat__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.chat__row--user {
  justify-content: flex-end;
}

.chat__avatar {
  flex: none;
  color: rgb(var(--v-theme-on-primary));
  background: linear-gradient(135deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-secondary)));
}

.chat__bubble {
  max-width: min(680px, 88%);
  padding: 10px 14px;
  border-radius: 16px;
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.chat__row--user .chat__bubble {
  border-end-end-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.14);
}

.chat__row--assistant .chat__bubble {
  border-start-start-radius: 4px;
}

.chat__plain {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Stays in reach at the bottom of the screen, above a phone's bottom navigation. */
.chat__composer {
  position: sticky;
  bottom: calc(12px + var(--v-layout-bottom, 0px));
  z-index: 2;
  padding: 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}
</style>
