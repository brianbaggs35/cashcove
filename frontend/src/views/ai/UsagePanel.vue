<script setup lang="ts">
import { Coins, ExternalLink, Gauge, Hash, MessageSquare } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'

import { fetchAiUsage, type AiUsage } from '@/api/ai'
import { errorMessage } from '@/api/client'
import { useHousehold } from '@/composables/useHousehold'
import { useAiStore } from '@/stores/ai'
import { formatCost, formatTokens, PRICING_PAGES, priceLine } from '@/utils/ai'
import UsageChart from '@/views/ai/UsageChart.vue'
import UsageTable from '@/views/ai/UsageTable.vue'
import { RANGES } from '@/views/ai/usage'

/**
 * What the AI has been used for and what it cost: tokens and an estimate of the cost at each
 * provider's list price, by day, by model and by what it was for.
 */
const ai = useAiStore()
const { locale } = useHousehold()

const days = ref<(typeof RANGES)[number]['value']>(30)
const usage = ref<AiUsage | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  try {
    usage.value = await fetchAiUsage(days.value)
    error.value = null
  } catch (loadError) {
    error.value = errorMessage(loadError)
  } finally {
    loading.value = false
  }
}

/** The figures along the top. */
function tilesOf(current: AiUsage) {
  return [
    {
      key: 'month',
      label: 'This month',
      value: formatCost(current.this_month.cost_micros, locale.value),
      detail: `${current.this_month.calls.toLocaleString('en-US')} calls`,
      icon: Coins,
    },
    {
      key: 'range',
      label: `Last ${days.value} days`,
      value: formatCost(current.totals.cost_micros, locale.value),
      detail: `${current.totals.calls.toLocaleString('en-US')} calls`,
      icon: Gauge,
    },
    {
      key: 'in',
      label: 'Tokens sent',
      value: formatTokens(current.totals.input_tokens, locale.value),
      detail: 'What it was asked',
      icon: MessageSquare,
    },
    {
      key: 'out',
      label: 'Tokens back',
      value: formatTokens(current.totals.output_tokens, locale.value),
      detail: 'What it answered',
      icon: Hash,
    },
  ]
}

/** The model in use, with what a million tokens of it cost, from its provider's price list. */
const model = computed(() => {
  const found = ai.provider?.models.find((item) => item.id === ai.settings?.model)
  return found ? { name: found.name, price: priceLine(found, locale.value) } : null
})
const free = computed(() => ai.settings?.provider === 'ollama_local')

const pricing = [
  { key: 'anthropic', label: 'Anthropic’s prices', href: PRICING_PAGES.anthropic },
  { key: 'openai', label: 'OpenAI’s prices', href: PRICING_PAGES.openai },
  { key: 'ollama_cloud', label: 'Ollama Cloud’s prices', href: PRICING_PAGES.ollama_cloud },
] as const

watch(days, () => void load())
onMounted(() => {
  void load()
})
</script>

<template>
  <div data-test="ai-usage">
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-6"
      :text="`Couldn't load the usage. ${error}`"
      data-test="usage-error"
    >
      <template #append>
        <v-btn
          variant="text"
          size="small"
          :loading="loading"
          data-test="usage-retry"
          @click="load()"
        >
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <div class="text-label-large">Show the last</div>
      <v-btn-toggle
        v-model="days"
        mandatory
        divided
        variant="outlined"
        color="primary"
        density="comfortable"
        aria-label="How far back"
        data-test="usage-range"
      >
        <v-btn v-for="item in RANGES" :key="item.value" :value="item.value" size="small">
          {{ item.title }}
        </v-btn>
      </v-btn-toggle>
    </div>

    <v-skeleton-loader
      v-if="!usage && !error"
      type="heading, text, text"
      class="rounded-xl"
      data-test="usage-loading"
    />

    <template v-else-if="usage">
      <v-row class="mb-2" density="compact">
        <v-col v-for="tile in tilesOf(usage)" :key="tile.key" cols="6" md="3">
          <v-card class="h-100" :data-test="`usage-tile-${tile.key}`">
            <v-card-text class="pa-4">
              <div class="d-flex align-center ga-2 text-medium-emphasis mb-1">
                <v-icon :icon="tile.icon" size="18" />
                <span class="text-label-medium">{{ tile.label }}</span>
              </div>
              <div class="text-headline-small font-weight-bold tabular-nums">{{ tile.value }}</div>
              <div class="text-body-small text-medium-emphasis">{{ tile.detail }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-alert
        v-if="usage.unpriced_calls"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
        data-test="usage-unpriced"
      >
        {{ usage.unpriced_calls.toLocaleString('en-US') }}
        {{ usage.unpriced_calls === 1 ? 'call isn’t' : 'calls aren’t' }} in the cost, because the
        provider’s price list doesn’t have their model. Their tokens are counted.
      </v-alert>

      <div class="mb-6"><UsageChart :days="usage.days" /></div>

      <v-row>
        <v-col cols="12" lg="6">
          <v-card class="h-100">
            <v-card-text class="pa-5">
              <h2 class="text-title-medium font-weight-bold ma-0 mb-2">By model</h2>
              <UsageTable
                v-if="usage.models.length"
                heading="Model"
                caption="What each model was used for and what it cost"
                :rows="usage.models"
              />
              <p
                v-else
                class="text-body-medium text-medium-emphasis ma-0"
                data-test="usage-no-models"
              >
                No model has been used in this time.
              </p>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" lg="6">
          <v-card class="h-100">
            <v-card-text class="pa-5">
              <h2 class="text-title-medium font-weight-bold ma-0 mb-2">What it was for</h2>
              <UsageTable
                v-if="usage.purposes.length"
                heading="Used for"
                caption="What the AI was asked for and what it cost"
                :rows="usage.purposes"
              />
              <p
                v-else
                class="text-body-medium text-medium-emphasis ma-0"
                data-test="usage-no-purposes"
              >
                Nothing has been asked in this time.
              </p>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-card class="mt-6" data-test="usage-pricing">
        <v-card-text class="pa-5">
          <h2 class="text-title-medium font-weight-bold ma-0 mb-2">How the cost is worked out</h2>
          <p v-if="model" class="text-body-medium mb-2" data-test="usage-model">
            You’re using <strong>{{ model.name }}</strong
            ><template v-if="model.price">, at {{ model.price }}</template
            >.
          </p>
          <p v-else-if="free" class="text-body-medium mb-2" data-test="usage-free-note">
            Ollama on your own computer costs nothing, so its calls are counted but never add to the
            cost.
          </p>
          <p class="text-body-medium text-medium-emphasis mb-3">
            Every answer is counted by the tokens the provider says it used, and priced at the
            provider’s own list price (input and output, with cheaper cached input where the
            provider reports it). It’s an estimate: your provider’s bill is what counts. Days are
            UTC days.
          </p>
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              v-for="link in pricing"
              :key="link.key"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              variant="text"
              size="small"
              :append-icon="ExternalLink"
              :data-test="`pricing-${link.key}`"
            >
              {{ link.label }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </template>
  </div>
</template>
