<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import {
  MIN_LENGTH,
  estimateStrength,
  passwordProblem,
  type PasswordContext,
  type Strength,
} from '@/auth/password'

const props = withDefaults(
  defineProps<{
    label?: string
    autocomplete: 'current-password' | 'new-password'
    /** Shows how strong a new password is, using the same rules as the API. */
    meter?: boolean
    /** The person's name and email, which a new password shouldn't be built from. */
    context?: PasswordContext
    errorMessages?: string | string[]
    autofocus?: boolean
    testId?: string
  }>(),
  {
    label: 'Password',
    meter: false,
    context: () => ({}),
    errorMessages: () => [],
    autofocus: false,
    testId: 'password',
  },
)

const password = defineModel<string>({ required: true })
const visible = ref(false)
const capsLock = ref(false)
const strength = ref<Strength | null>(null)

function onKey(event: KeyboardEvent) {
  capsLock.value = event.getModifierState('CapsLock')
}

// Only the newest estimate counts, however quickly someone types.
let latest = 0
watch(
  [password, () => props.context],
  async ([value]) => {
    const request = ++latest
    if (!props.meter || !value) {
      strength.value = null
      return
    }
    const result = await estimateStrength(value, props.context)
    if (request === latest) strength.value = result
  },
  { immediate: true },
)

// Only read by the meter, and only once something's been typed.
const problem = computed(() => passwordProblem(password.value, props.context))

const LEVELS = [
  { bars: 1, color: 'error', label: 'Easy to guess' },
  { bars: 1, color: 'error', label: 'Easy to guess' },
  { bars: 2, color: 'warning', label: 'Fair' },
  { bars: 3, color: 'success', label: 'Strong' },
  { bars: 4, color: 'success', label: 'Excellent' },
] as const

const level = computed(() => {
  if (!password.value) return null
  if (problem.value) return { bars: 1, color: 'error', label: 'Not yet' }
  return strength.value ? LEVELS[strength.value.score] : null
})

const tip = computed(() => {
  if (!password.value) {
    return `Use at least ${MIN_LENGTH} characters. A few random words are strong and easy to remember.`
  }
  if (problem.value) return problem.value
  if (strength.value?.warning) return strength.value.warning
  if (strength.value && strength.value.score < 3) return strength.value.suggestions[0] ?? null
  return strength.value ? 'Looks good. A password manager can remember it for you.' : null
})
</script>

<template>
  <div class="password-field">
    <v-text-field
      v-model="password"
      :label="label"
      :type="visible ? 'text' : 'password'"
      :autocomplete="autocomplete"
      :autofocus="autofocus"
      :error-messages="errorMessages"
      :messages="capsLock ? ['Caps Lock is on'] : []"
      autocapitalize="off"
      spellcheck="false"
      hide-details="auto"
      :data-test="testId"
      @keydown="onKey"
      @keyup="onKey"
    >
      <template #append-inner>
        <v-btn
          :icon="visible ? EyeOff : Eye"
          variant="text"
          size="small"
          density="comfortable"
          :aria-label="visible ? 'Hide password' : 'Show password'"
          :aria-pressed="visible"
          :data-test="`${testId}-toggle`"
          @click="visible = !visible"
        />
      </template>
    </v-text-field>

    <div v-if="meter" class="password-field__meter mt-3" :data-test="`${testId}-meter`">
      <div class="d-flex align-center ga-3">
        <div class="password-field__bars flex-grow-1" aria-hidden="true">
          <span
            v-for="bar in 4"
            :key="bar"
            class="password-field__bar"
            :class="level && bar <= level.bars ? `password-field__bar--${level.color}` : undefined"
          />
        </div>
        <span
          class="text-label-medium password-field__label"
          :class="level ? `text-${level.color}` : 'text-medium-emphasis'"
          aria-live="polite"
          :data-test="`${testId}-strength`"
        >
          {{ level?.label ?? 'Strength' }}
        </span>
      </div>
      <p
        v-if="tip"
        class="text-body-small text-medium-emphasis mt-2 mb-0"
        :data-test="`${testId}-tip`"
      >
        {{ tip }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.password-field__bars {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.password-field__bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  transition: background-color 0.25s ease;
}

/* Scoped styles outrank Vuetify's layered bg-* helpers, so the filled bars set their own colour. */
.password-field__bar--error {
  background: rgb(var(--v-theme-error));
}

.password-field__bar--warning {
  background: rgb(var(--v-theme-warning));
}

.password-field__bar--success {
  background: rgb(var(--v-theme-success));
}

.password-field__label {
  min-width: 96px;
  text-align: end;
}
</style>
