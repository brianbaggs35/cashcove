<script setup lang="ts">
import { Check, X } from '@lucide/vue'
import { ref } from 'vue'

import { approveAiProposal, rejectAiProposal, type AiProposal } from '@/api/ai'
import { useAction } from '@/composables/useAction'

const props = defineProps<{ proposal: AiProposal; disabled?: boolean }>()
const emit = defineEmits<{
  'update:proposal': [proposal: AiProposal]
  feedback: [note: string]
}>()

const STATES = {
  pending: { label: 'Pending approval', color: 'primary' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'error' },
  expired: { label: 'Expired', color: 'warning' },
} as const

const rejecting = ref(false)
const note = ref('')
const decide = useAction(async (decision: 'approve' | 'reject', reason: string | null) =>
  decision === 'approve'
    ? approveAiProposal(props.proposal.id)
    : rejectAiProposal(props.proposal.id, reason),
)

async function approve() {
  const updated = await decide.run('approve', null)
  if (updated) emit('update:proposal', updated)
}

function beginRejecting() {
  decide.clear()
  rejecting.value = true
}

function cancelRejecting() {
  rejecting.value = false
  note.value = ''
  decide.clear()
}

async function reject() {
  const reason = note.value.trim()
  const updated = await decide.run('reject', reason || null)
  if (!updated) return

  emit('update:proposal', updated)
  rejecting.value = false
  note.value = ''
  if (reason) {
    const changes = props.proposal.steps.map((step) => step.title).join('; ')
    emit('feedback', `I turned that down. Proposed: ${changes}. Reason: ${reason}`)
  }
}
</script>

<template>
  <v-card variant="outlined" class="mt-4" :data-state="proposal.state" data-test="ai-proposal">
    <v-card-title class="d-flex align-center flex-wrap ga-2 text-body-large font-weight-bold">
      <span class="flex-grow-1">{{ proposal.title }}</span>
      <v-chip
        size="small"
        variant="tonal"
        :color="STATES[proposal.state].color"
        data-test="proposal-status"
      >
        {{ STATES[proposal.state].label }}
      </v-chip>
    </v-card-title>
    <v-card-text>
      <p class="text-body-medium mb-3" data-test="proposal-message">{{ proposal.message }}</p>
      <ol class="proposal__steps ps-5" data-test="proposal-steps">
        <li v-for="(step, index) in proposal.steps" :key="`${step.tool}-${index}`" class="mb-3">
          <strong>{{ step.title }}</strong>
          <p class="text-body-small mb-1">{{ step.summary }}</p>
          <ul v-if="step.details.length" class="ps-5">
            <li v-for="detail in step.details" :key="detail" class="text-body-small">
              {{ detail }}
            </li>
          </ul>
        </li>
      </ol>

      <ul
        v-if="proposal.results.length"
        class="proposal__results ps-5"
        data-test="proposal-results"
      >
        <li v-for="result in proposal.results" :key="result">{{ result }}</li>
      </ul>
      <p v-if="proposal.note" class="text-body-small mt-3 mb-0" data-test="proposal-note">
        Your note: {{ proposal.note }}
      </p>

      <v-alert
        v-if="decide.error.value"
        type="error"
        variant="tonal"
        density="compact"
        class="mt-3"
        :text="decide.error.value"
        data-test="proposal-error"
      />

      <div v-if="proposal.state === 'pending' && !rejecting" class="d-flex flex-wrap ga-2 mt-4">
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          :prepend-icon="Check"
          :disabled="disabled || decide.busy.value"
          data-test="proposal-approve"
          @click="approve"
        >
          Approve
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          :prepend-icon="X"
          :disabled="disabled || decide.busy.value"
          data-test="proposal-reject"
          @click="beginRejecting"
        >
          Reject
        </v-btn>
      </div>

      <div v-else-if="proposal.state === 'pending' && rejecting" class="mt-4">
        <v-textarea
          v-model="note"
          label="Why are you rejecting this?"
          rows="2"
          maxlength="500"
          counter
          hide-details="auto"
          :disabled="disabled || decide.busy.value"
          data-test="proposal-reject-note"
        />
        <div class="d-flex flex-wrap justify-end ga-2 mt-3">
          <v-btn
            variant="text"
            size="small"
            :disabled="disabled || decide.busy.value"
            data-test="proposal-reject-cancel"
            @click="cancelRejecting"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            variant="tonal"
            size="small"
            :loading="decide.busy.value"
            :disabled="disabled"
            data-test="proposal-reject-confirm"
            @click="reject"
          >
            Reject
          </v-btn>
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.proposal__steps,
.proposal__results {
  margin-block: 0;
}
</style>
