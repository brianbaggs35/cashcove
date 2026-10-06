<script setup lang="ts">
import { FlaskConical, Power, RefreshCw, Save, ShieldCheck, Sparkles } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import {
  fetchAiModels,
  testAiConnection,
  type AiConnectionInput,
  type AiModel,
  type AiProviderKey,
  type AiTestResult,
} from '@/api/ai'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import SecretField from '@/components/ui/SecretField.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useHousehold } from '@/composables/useHousehold'
import { useAiStore } from '@/stores/ai'
import { useAuthStore } from '@/stores/auth'
import { formatCount } from '@/utils/format'
import AiPrivacyNotice from '@/views/ai/AiPrivacyNotice.vue'
import { modelDetail, modelItems, problemWithAddress } from '@/views/settings/ai'
import SettingsCard from '@/views/settings/SettingsCard.vue'

/**
 * Settings > AI: which provider the household uses, its key and its model. AI is optional, so
 * this is where it's turned on, tried before it's saved and turned off. The key goes to the
 * server and is never shown again.
 */
const ai = useAiStore()
const auth = useAuthStore()
const { locale } = useHousehold()

const provider = ref<AiProviderKey | null>(null)
const model = ref('')
const baseUrl = ref('')
const apiKey = ref('')
const reviewImports = ref(true)
/** Ollama's models, once they've been fetched from the server. */
const fetched = ref<AiModel[] | null>(null)
const result = ref<AiTestResult | null>(null)

const info = computed(() => ai.providers.find((item) => item.key === provider.value))
const needsUrl = computed(() => info.value?.needs_url === true)
const needsKey = computed(() => info.value?.needs_key === true)
/** A key is saved for this provider, which a blank key field keeps. */
const keySaved = computed(
  () => ai.settings?.api_key_set === true && ai.settings.provider === provider.value,
)
const addressProblem = computed(() => (needsUrl.value ? problemWithAddress(baseUrl.value) : null))
/** Enough is filled in to reach the provider. */
const reachable = computed(
  () =>
    !!info.value &&
    !addressProblem.value &&
    (!needsKey.value || !!apiKey.value.trim() || keySaved.value),
)
const canSave = computed(() => reachable.value && !!model.value)
const items = computed(() => modelItems(info.value?.models, fetched.value, model.value))
const chosen = computed(() => items.value.find((item) => item.value === model.value)?.model ?? null)
/** Under the model: what it's good for and costs, or, for Ollama, to fetch the models first. */
const modelHint = computed(
  () =>
    modelDetail(chosen.value, locale.value) ||
    (info.value?.models.length || fetched.value
      ? undefined
      : 'Fetch the models first, then choose one.'),
)

function connection(): AiConnectionInput {
  return {
    provider: provider.value as AiProviderKey,
    base_url: needsUrl.value ? baseUrl.value.trim() : null,
    api_key: apiKey.value.trim() || null,
    model: model.value || null,
  }
}

/** Fills the form in from what's saved, or empty when nothing is. */
function hydrate() {
  const saved = ai.settings
  provider.value = saved?.provider ?? null
  model.value = saved?.model ?? ''
  baseUrl.value = saved?.base_url ?? ''
  apiKey.value = ''
  reviewImports.value = saved?.review_imports ?? true
  fetched.value = null
  result.value = null
}

/** A different provider starts from its own defaults, or from what's saved if it's the saved one. */
function choose(key: AiProviderKey | null) {
  const next = ai.providers.find((item) => item.key === key)
  const saved = ai.settings?.provider === key ? ai.settings : null
  provider.value = key
  apiKey.value = ''
  fetched.value = null
  result.value = null
  model.value = saved?.model ?? next?.default_model ?? ''
  baseUrl.value = next?.needs_url ? (saved?.base_url ?? next.default_url ?? '') : ''
}

const fetch = useAction(async () => {
  result.value = null
  fetched.value = (await fetchAiModels(connection())).models
  if (!model.value || !fetched.value.some((item) => item.id === model.value)) {
    model.value = fetched.value[0]?.id ?? ''
  }
})
const test = useAction(async () => {
  result.value = await testAiConnection(connection())
})
const save = useAction(async () => {
  await ai.save({
    provider: provider.value as AiProviderKey,
    model: model.value,
    base_url: needsUrl.value ? baseUrl.value.trim() : null,
    api_key: apiKey.value.trim() || null,
    review_imports: reviewImports.value,
  })
  notify('AI settings saved')
  hydrate()
})
/** What went wrong with the last test or save. */
const problem = computed(() => test.error.value ?? save.error.value)

async function turnOff() {
  const done = await confirmAndRun(
    {
      title: 'Turn off AI?',
      text: 'Cashcove forgets the API key. Everything else works as it did, and past suggestions and usage are kept.',
      confirmText: 'Turn off AI',
      tone: 'warning',
      icon: Power,
    },
    () => ai.remove(),
  )
  if (done) {
    notify('AI is off')
    hydrate()
  }
}

/** Anything changed since the last try makes its result out of date. */
function edited() {
  result.value = null
}

onMounted(async () => {
  await ai.ensureLoaded()
  hydrate()
})
</script>

<template>
  <div data-test="ai-settings">
    <v-alert
      v-if="ai.error && !ai.loaded"
      type="error"
      variant="tonal"
      class="mb-6"
      :text="`Couldn't load the AI settings. ${ai.error}`"
      data-test="ai-settings-error"
    >
      <template #append>
        <v-btn
          variant="text"
          size="small"
          :loading="ai.loading"
          data-test="ai-settings-retry"
          @click="ai.load()"
        >
          Try again
        </v-btn>
      </template>
    </v-alert>

    <v-card v-else-if="!ai.loaded" class="pa-6 mb-6" data-test="ai-settings-loading">
      <v-skeleton-loader type="heading, list-item-two-line@3" />
    </v-card>

    <template v-else>
      <ReadOnlyNotice
        v-if="!auth.isAdmin"
        text="You can see how AI is set up. Only an admin can change it."
      />

      <SettingsCard
        title="AI provider"
        subtitle="It’s optional. Cashcove works the same without it, and with it you can ask about your money and get a second opinion on how your transactions are sorted."
        :icon="Sparkles"
      >
        <template #append>
          <v-chip
            :color="ai.configured ? 'success' : undefined"
            variant="tonal"
            size="small"
            data-test="ai-status"
          >
            {{ ai.configured ? `On · ${ai.modelName}` : 'Off' }}
          </v-chip>
        </template>

        <dl v-if="!auth.isAdmin" class="ai-summary" data-test="ai-summary">
          <template v-if="ai.configured">
            <dt class="text-label-large">Provider</dt>
            <dd class="text-body-medium mb-3">{{ ai.provider?.name }}</dd>
            <dt class="text-label-large">Model</dt>
            <dd class="text-body-medium mb-3">{{ ai.modelName }}</dd>
            <dt class="text-label-large">Imported files</dt>
            <dd class="text-body-medium mb-0">
              {{
                ai.settings?.review_imports
                  ? 'Get a second opinion on how they were sorted'
                  : 'Aren’t reviewed'
              }}
            </dd>
          </template>
          <dd v-else class="text-body-medium mb-0">An admin can turn it on here.</dd>
        </dl>

        <v-form v-else data-test="ai-form" @submit.prevent="save.run()">
          <v-radio-group
            :model-value="provider"
            label="Where should the AI run?"
            hide-details
            class="mb-4"
            data-test="ai-provider"
            @update:model-value="choose"
          >
            <v-row density="compact">
              <v-col v-for="item in ai.providers" :key="item.key" cols="12" sm="6">
                <label
                  class="ai-provider d-flex align-start ga-2 pa-3 h-100"
                  :class="{ 'ai-provider--active': provider === item.key }"
                >
                  <v-radio
                    :value="item.key"
                    density="comfortable"
                    hide-details
                    class="flex-grow-0"
                    :aria-label="item.name"
                    :data-test="`provider-${item.key}`"
                  />
                  <span class="d-block">
                    <span class="d-block text-body-large font-weight-medium">{{ item.name }}</span>
                    <span class="d-block text-body-small text-medium-emphasis">{{
                      item.summary
                    }}</span>
                  </span>
                </label>
              </v-col>
            </v-row>
          </v-radio-group>

          <template v-if="info">
            <v-row>
              <v-col v-if="needsUrl" cols="12">
                <v-text-field
                  v-model="baseUrl"
                  label="Ollama address"
                  inputmode="url"
                  autocomplete="off"
                  spellcheck="false"
                  :error-messages="baseUrl && addressProblem ? addressProblem : undefined"
                  :hint="`Where Ollama is running. Cashcove runs in a container, so “localhost” is the container itself: use ${info.default_url} for Ollama on this computer, and let Ollama listen on all addresses (OLLAMA_HOST=0.0.0.0).`"
                  persistent-hint
                  data-test="ai-url"
                  @update:model-value="edited"
                />
              </v-col>
              <v-col v-if="needsKey" cols="12">
                <SecretField
                  v-model="apiKey"
                  label="API key"
                  :hint="
                    keySaved
                      ? 'A key is saved for this provider. Leave this blank to keep it, or paste a new one to replace it.'
                      : undefined
                  "
                  test-id="ai-key"
                  @update:model-value="edited"
                />
                <p v-if="info.key_url" class="text-body-small text-medium-emphasis mt-2 mb-0">
                  Make a key at
                  <a
                    :href="info.key_url"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-test="ai-key-link"
                    >{{ info.key_url }}</a
                  >. It stays on the server, and is never shown here again.
                </p>
              </v-col>

              <v-col cols="12" :md="info.models.length ? 12 : 8">
                <v-select
                  v-model="model"
                  :items="items"
                  :label="info.models.length ? 'Model' : 'Model on the server'"
                  :hint="modelHint"
                  persistent-hint
                  :no-data-text="'Fetch the models first.'"
                  data-test="ai-model"
                  @update:model-value="edited"
                >
                  <template #item="{ props: itemProps, item }">
                    <v-list-item v-bind="itemProps" :subtitle="modelDetail(item.model, locale)">
                      <template v-if="item.model?.deprecated" #append>
                        <v-chip size="x-small" color="warning" variant="tonal"
                          >Shutting down</v-chip
                        >
                      </template>
                    </v-list-item>
                  </template>
                </v-select>
              </v-col>
              <v-col v-if="!info.models.length" cols="12" md="4" class="d-flex align-start">
                <v-btn
                  variant="tonal"
                  block
                  size="large"
                  :prepend-icon="RefreshCw"
                  :loading="fetch.busy.value"
                  :disabled="!reachable"
                  data-test="ai-fetch"
                  @click="fetch.run()"
                >
                  Fetch models
                </v-btn>
              </v-col>
            </v-row>

            <v-alert
              v-if="fetched"
              :type="fetched.length ? 'success' : 'warning'"
              variant="tonal"
              density="compact"
              class="mb-4"
              data-test="ai-fetched"
            >
              <template v-if="fetched.length">
                Found {{ formatCount(fetched.length, 'model') }} that can chat. Choose one above.
              </template>
              <template v-else>
                That server has no models that can chat. Pull one first, like
                <code>ollama pull llama3.2</code>, then fetch again.
              </template>
            </v-alert>
            <v-alert
              v-if="fetch.error.value"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-4"
              :text="fetch.error.value"
              data-test="ai-fetch-error"
            />

            <v-switch
              v-model="reviewImports"
              color="primary"
              inset
              hide-details
              label="Get a second opinion on imported files"
              data-test="ai-review-imports"
            />
            <p class="text-body-small text-medium-emphasis ms-14 mb-4">
              After a file is imported, the AI looks over how its transactions were sorted and
              suggests changes. It only suggests: nothing changes until you apply it.
            </p>

            <v-alert
              v-if="result"
              :type="result.ok ? 'success' : 'error'"
              variant="tonal"
              density="compact"
              class="mb-4"
              :text="result.message"
              data-test="ai-test-result"
            />
            <v-alert
              v-if="problem"
              type="error"
              variant="tonal"
              density="compact"
              class="mb-4"
              :text="problem"
              data-test="ai-error"
            />

            <div class="d-flex flex-wrap ga-2">
              <v-btn
                variant="tonal"
                :prepend-icon="FlaskConical"
                :loading="test.busy.value"
                :disabled="!reachable"
                data-test="ai-test"
                @click="test.run()"
              >
                Test connection
              </v-btn>
              <v-btn
                type="submit"
                color="primary"
                variant="flat"
                :prepend-icon="Save"
                :loading="save.busy.value"
                :disabled="!canSave"
                data-test="ai-save"
              >
                Save
              </v-btn>
              <v-spacer />
              <v-btn
                v-if="ai.configured"
                variant="text"
                color="error"
                :prepend-icon="Power"
                data-test="ai-off"
                @click="turnOff"
              >
                Turn off AI
              </v-btn>
            </div>
          </template>
        </v-form>
      </SettingsCard>

      <SettingsCard
        title="What the AI can see"
        subtitle="Cashcove never sends account information to an AI, however it’s asked."
        :icon="ShieldCheck"
      >
        <AiPrivacyNotice full />
      </SettingsCard>
    </template>
  </div>
</template>

<style scoped>
.ai-provider {
  cursor: pointer;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
}

.ai-provider:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.ai-provider--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.ai-provider:focus-within {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.ai-summary dt {
  margin-bottom: 2px;
}

.ai-summary dd {
  margin-inline-start: 0;
}
</style>
