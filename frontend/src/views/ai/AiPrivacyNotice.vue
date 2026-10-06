<script setup lang="ts">
import { Check, ShieldCheck, X } from '@lucide/vue'
import { ref } from 'vue'

/**
 * What the AI is and isn't told, and how that's kept true. The short version sits where someone
 * is about to ask; the full one is what Settings > AI shows.
 */
withDefaults(defineProps<{ full?: boolean }>(), { full: false })

const open = ref(false)

const shared = [
  'Dates, amounts and payees, with anything that looks like an account number, an email address or a key taken out of the payee.',
  'Category names, budgets, and the names of your subscriptions and bills.',
  'What you type, with the same things taken out.',
]
const never = [
  'Account numbers, card numbers or the last digits of either.',
  'The names of your accounts, and the names of your banks.',
  'Balances, bank connections and sign-ins.',
  'What the bank wrote beside a payee, and the notes on a transaction.',
  'Your API key, which stays on the server and is never shown again.',
]
</script>

<template>
  <div data-test="ai-privacy">
    <v-alert
      v-if="!full"
      :icon="ShieldCheck"
      color="primary"
      variant="tonal"
      density="compact"
      class="ai-privacy__alert"
    >
      <div class="d-flex flex-wrap align-center ga-x-2">
        <span class="text-body-small">
          Account numbers, account names and bank names are never sent to the AI.
        </span>
        <v-btn
          variant="text"
          size="x-small"
          class="px-1"
          :aria-expanded="open"
          data-test="ai-privacy-toggle"
          @click="open = !open"
        >
          {{ open ? 'Hide details' : 'What is shared?' }}
        </v-btn>
      </div>
    </v-alert>

    <v-expand-transition>
      <div v-if="full || open" class="ai-privacy__lists" :class="{ 'mt-3': !full }">
        <v-row>
          <v-col cols="12" md="6">
            <h4 class="text-label-large mb-2">What the AI is told</h4>
            <ul class="ai-privacy__list">
              <li v-for="item in shared" :key="item" class="d-flex ga-2">
                <v-icon :icon="Check" size="18" color="success" class="mt-1" />
                <span class="text-body-medium">{{ item }}</span>
              </li>
            </ul>
          </v-col>
          <v-col cols="12" md="6">
            <h4 class="text-label-large mb-2">What it is never told</h4>
            <ul class="ai-privacy__list">
              <li v-for="item in never" :key="item" class="d-flex ga-2">
                <v-icon :icon="X" size="18" color="error" class="mt-1" />
                <span class="text-body-medium">{{ item }}</span>
              </li>
            </ul>
          </v-col>
        </v-row>
        <p class="text-body-medium mb-2" data-test="ai-privacy-guard">
          Everything is checked again just before it leaves Cashcove. If anything left looks like
          account information, the request is refused and nothing is sent. The AI only ever
          suggests: it can't change anything, and a category you chose yourself is never
          second-guessed.
        </p>
      </div>
    </v-expand-transition>
  </div>
</template>

<style scoped>
.ai-privacy__list {
  display: grid;
  gap: 8px;
  padding: 0;
  list-style: none;
}
</style>
