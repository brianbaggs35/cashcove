<script setup lang="ts">
import { computed, ref } from 'vue'

/** Picks an emoji from a set that suits money, or takes any other one typed or pasted in. */
const model = defineModel<string>({ required: true })
defineProps<{ label?: string }>()

const EMOJI: [string, string][] = [
  ['🛒', 'Shopping cart'],
  ['🍽️', 'Plate'],
  ['☕', 'Coffee'],
  ['🍔', 'Burger'],
  ['🍕', 'Pizza'],
  ['🥐', 'Croissant'],
  ['🍺', 'Beer'],
  ['🍷', 'Wine'],
  ['🏠', 'House'],
  ['🛠️', 'Tools'],
  ['🛋️', 'Couch'],
  ['💡', 'Light bulb'],
  ['🔥', 'Fire'],
  ['💧', 'Water'],
  ['📱', 'Phone'],
  ['🌐', 'Internet'],
  ['📺', 'Television'],
  ['🎵', 'Music'],
  ['🛡️', 'Shield'],
  ['🚗', 'Car'],
  ['⛽', 'Fuel pump'],
  ['🅿️', 'Parking'],
  ['🚆', 'Train'],
  ['🚕', 'Taxi'],
  ['✈️', 'Airplane'],
  ['🏨', 'Hotel'],
  ['🧳', 'Luggage'],
  ['🛍️', 'Shopping bags'],
  ['👕', 'T-shirt'],
  ['👟', 'Sneaker'],
  ['💻', 'Laptop'],
  ['🎮', 'Video game'],
  ['📚', 'Books'],
  ['🎓', 'Graduation cap'],
  ['🧸', 'Teddy bear'],
  ['👶', 'Baby'],
  ['🐾', 'Paw prints'],
  ['🩺', 'Stethoscope'],
  ['💊', 'Pill'],
  ['🦷', 'Tooth'],
  ['🏋️', 'Weights'],
  ['💇', 'Haircut'],
  ['🎬', 'Film'],
  ['🎟️', 'Ticket'],
  ['🎁', 'Gift'],
  ['🎉', 'Party'],
  ['❤️', 'Heart'],
  ['🙏', 'Thanks'],
  ['💼', 'Briefcase'],
  ['💰', 'Money bag'],
  ['📈', 'Chart going up'],
  ['🏦', 'Bank'],
  ['💳', 'Credit card'],
  ['💵', 'Banknotes'],
  ['🪙', 'Coin'],
  ['🧾', 'Receipt'],
  ['🏧', 'Cash machine'],
  ['🔁', 'Repeat'],
  ['📦', 'Package'],
  ['🌱', 'Seedling'],
  ['⭐', 'Star'],
  ['🏷️', 'Label'],
]

const open = ref(false)
const typed = ref('')
const custom = computed(() => typed.value.trim())

function choose(emoji: string) {
  model.value = emoji
  typed.value = ''
  open.value = false
}

function useTyped() {
  // Emoji are a single "word" of up to 16 characters; the API checks the same.
  if (custom.value && custom.value.length <= 16 && !/\s/.test(custom.value)) choose(custom.value)
}
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom start">
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        variant="outlined"
        class="emoji-picker__button"
        height="48"
        min-width="64"
        :aria-label="`${label ?? 'Emoji'}: ${model}. Choose another`"
        data-test="emoji-picker"
      >
        <span class="emoji-picker__current" aria-hidden="true">{{ model }}</span>
      </v-btn>
    </template>
    <v-card class="pa-3" max-width="332" data-test="emoji-menu">
      <div class="emoji-picker__grid" role="group" :aria-label="label ?? 'Emoji'">
        <button
          v-for="[emoji, name] in EMOJI"
          :key="emoji"
          type="button"
          class="emoji-picker__option"
          :class="{ 'emoji-picker__option--active': emoji === model }"
          :aria-label="name"
          :aria-pressed="emoji === model"
          data-test="emoji-option"
          @click="choose(emoji)"
        >
          {{ emoji }}
        </button>
      </div>
      <v-text-field
        v-model="typed"
        label="Or type any emoji"
        density="compact"
        hide-details
        class="mt-3"
        data-test="emoji-custom"
        @keydown.enter.prevent="useTyped"
      >
        <template #append-inner>
          <v-btn
            size="small"
            variant="text"
            color="primary"
            :disabled="!custom"
            data-test="emoji-custom-use"
            @click="useTyped"
          >
            Use
          </v-btn>
        </template>
      </v-text-field>
    </v-card>
  </v-menu>
</template>

<style scoped>
.emoji-picker__current {
  font-size: 1.5rem;
  line-height: 1;
}

.emoji-picker__grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}

.emoji-picker__option {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  border-radius: 10px;
  font-size: 1.35rem;
  cursor: pointer;
  transition: background-color 0.15s;
}

.emoji-picker__option:hover,
.emoji-picker__option:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.08);
  outline: none;
}

.emoji-picker__option--active {
  background: rgba(var(--v-theme-primary), 0.16);
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}
</style>
