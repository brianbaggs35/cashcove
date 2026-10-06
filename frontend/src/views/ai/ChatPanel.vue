<script setup lang="ts">
import { Eraser, SendHorizontal, Sparkles } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'

import { MAX_LENGTH, useAiChat } from '@/stores/aiChat'
import AiPrivacyNotice from '@/views/ai/AiPrivacyNotice.vue'
import AiText from '@/views/ai/AiText.vue'

/**
 * Asking the AI about the household's money. It answers from a fresh summary of the records
 * (totals, budgets, bills and the latest transactions) that has no account in it.
 */
const chat = useAiChat()
const draft = ref('')
const end = ref<HTMLElement | null>(null)

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

// Whatever is added, the newest is in view.
watch(
  () => [chat.messages.length, chat.busy, chat.error],
  async () => {
    await nextTick()
    end.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  },
)
</script>

<template>
  <section aria-label="Ask the AI" data-test="ai-chat">
    <AiPrivacyNotice class="mb-4" />

    <v-card>
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
            <p v-if="message.role === 'user'" class="chat__plain ma-0 text-body-medium">
              {{ message.content }}
            </p>
            <AiText v-else :text="message.content" />
          </div>
        </div>

        <div v-if="chat.busy" class="chat__row chat__row--assistant" data-test="chat-busy">
          <v-avatar size="32" class="chat__avatar"><v-icon :icon="Sparkles" size="18" /></v-avatar>
          <div class="chat__bubble d-flex align-center ga-3">
            <v-progress-circular indeterminate size="18" width="2" color="primary" />
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
  </section>
</template>

<style scoped>
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
