<script setup lang="ts">
import { Mail, MessageCircle, Save, ShieldCheck, Zap } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import {
  fetchAlertDeliverySettings,
  saveAlertDeliverySettings,
  testDiscordWebhook,
  testSmtpConnection,
  type AlertDeliverySettings,
  type AlertSettingsPatch,
  type AlertTestResult,
  type SmtpSecurity,
} from '@/api/alerts'
import { errorMessage } from '@/api/client'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useAuthStore } from '@/stores/auth'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const auth = useAuthStore()
const saved = ref<AlertDeliverySettings | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const discordEnabled = ref(false)
const discordWebhook = ref('')
const clearWebhook = ref(false)
const discordResult = ref<AlertTestResult | null>(null)

const smtpEnabled = ref(false)
const smtpHost = ref('')
const smtpPort = ref(587)
const smtpSecurity = ref<SmtpSecurity>('starttls')
const smtpFrom = ref('')
const smtpTo = ref('')
const smtpAuthentication = ref(false)
const smtpUsername = ref('')
const smtpPassword = ref('')
const clearSmtpCredentials = ref(false)
const smtpResult = ref<AlertTestResult | null>(null)

const hasSavedSmtpCredentials = computed(
  () => saved.value?.smtp_username_set === true || saved.value?.smtp_password_set === true,
)
const smtpCredentialsReady = computed(
  () =>
    !smtpAuthentication.value ||
    ((!!smtpUsername.value.trim() || saved.value?.smtp_username_set === true) &&
      (!!smtpPassword.value || saved.value?.smtp_password_set === true)),
)
const smtpCanTest = computed(
  () =>
    auth.isAdmin &&
    !!smtpHost.value.trim() &&
    !!smtpFrom.value.trim() &&
    !!smtpTo.value.trim() &&
    (smtpSecurity.value !== 'none' || !smtpAuthentication.value) &&
    smtpCredentialsReady.value,
)

function hydrate(value: AlertDeliverySettings) {
  saved.value = value
  discordEnabled.value = value.discord_enabled
  discordWebhook.value = ''
  clearWebhook.value = false
  discordResult.value = null

  smtpEnabled.value = value.smtp_enabled
  smtpHost.value = value.smtp_host ?? ''
  smtpPort.value = value.smtp_port
  smtpSecurity.value = value.smtp_security
  smtpFrom.value = value.smtp_from ?? ''
  smtpTo.value = value.smtp_to ?? ''
  smtpAuthentication.value = value.smtp_username_set || value.smtp_password_set
  smtpUsername.value = ''
  smtpPassword.value = ''
  clearSmtpCredentials.value = false
  smtpResult.value = null
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    hydrate(await fetchAlertDeliverySettings())
  } catch (error) {
    loadError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

function editedDiscord() {
  clearWebhook.value = false
  discordResult.value = null
}

function editedSmtp() {
  clearSmtpCredentials.value = false
  smtpResult.value = null
}

function discordPatch(): AlertSettingsPatch {
  const patch: AlertSettingsPatch = { discord_enabled: discordEnabled.value }
  const webhook = discordWebhook.value.trim()
  if (webhook) patch.discord_webhook_url = webhook
  if (clearWebhook.value) patch.clear_discord_webhook = true
  return patch
}

function smtpPatch(): AlertSettingsPatch {
  const patch: AlertSettingsPatch = {
    smtp_enabled: smtpEnabled.value,
    smtp_host: smtpHost.value.trim() || null,
    smtp_port: smtpPort.value,
    smtp_security: smtpSecurity.value,
    smtp_from: smtpFrom.value.trim() || null,
    smtp_to: smtpTo.value.trim() || null,
  }
  if (smtpAuthentication.value) {
    if (smtpUsername.value.trim()) patch.smtp_username = smtpUsername.value.trim()
    if (smtpPassword.value) patch.smtp_password = smtpPassword.value
  } else if (hasSavedSmtpCredentials.value || smtpUsername.value || smtpPassword.value) {
    patch.clear_smtp_credentials = true
  }
  return patch
}

const saveDiscord = useAction(async () => {
  testDiscord.clear()
  hydrate(await saveAlertDeliverySettings(discordPatch()))
  notify('Discord alert settings saved')
})
const testDiscord = useAction(async () => {
  saveDiscord.clear()
  discordResult.value = await testDiscordWebhook(discordPatch())
})
const saveSmtp = useAction(async () => {
  testSmtp.clear()
  hydrate(await saveAlertDeliverySettings(smtpPatch()))
  notify('Email alert settings saved')
})
const testSmtp = useAction(async () => {
  saveSmtp.clear()
  smtpResult.value = await testSmtpConnection(smtpPatch())
})

function removeWebhook() {
  discordWebhook.value = ''
  discordEnabled.value = false
  clearWebhook.value = true
  discordResult.value = null
}

onMounted(() => void load())
</script>

<template>
  <div data-test="alert-delivery-settings">
    <v-alert
      v-if="loadError"
      type="error"
      variant="tonal"
      title="Couldn't load alert delivery settings"
      :text="loadError"
      data-test="alert-delivery-error"
    >
      <template #append>
        <v-btn
          variant="text"
          size="small"
          :loading="loading"
          data-test="alert-delivery-retry"
          @click="load"
        >
          Try again
        </v-btn>
      </template>
    </v-alert>

    <v-card v-else-if="loading" class="pa-6 mb-6" data-test="alert-delivery-loading">
      <v-skeleton-loader type="heading, list-item-two-line@3" />
    </v-card>

    <template v-else>
      <ReadOnlyNotice v-if="!auth.isAdmin" />

      <SettingsCard
        title="Discord"
        subtitle="Send alerts to a Discord channel using a webhook."
        :icon="MessageCircle"
      >
        <template #append>
          <v-chip
            :color="saved?.discord_configured ? 'success' : undefined"
            variant="tonal"
            size="small"
            data-test="alert-discord-status"
          >
            {{ saved?.discord_configured ? 'On' : discordEnabled ? 'Needs setup' : 'Off' }}
          </v-chip>
          <v-switch
            v-model="discordEnabled"
            color="primary"
            inset
            hide-details
            density="compact"
            aria-label="Discord alerts"
            data-test="alert-discord-enabled"
            :disabled="!auth.isAdmin"
            @update:model-value="editedDiscord()"
          />
        </template>

        <v-form
          :readonly="!auth.isAdmin"
          data-test="alert-discord-form"
          @submit.prevent="saveDiscord.run()"
        >
          <v-text-field
            v-model="discordWebhook"
            type="password"
            label="Discord webhook URL"
            autocomplete="off"
            spellcheck="false"
            hide-details="auto"
            data-test="alert-discord-webhook"
            @update:model-value="editedDiscord()"
          />
          <p
            v-if="saved?.discord_webhook_set && !clearWebhook"
            class="text-body-small text-medium-emphasis mt-2 mb-0"
            data-test="alert-discord-saved"
          >
            A webhook is saved encrypted. Leave this blank to keep it.
          </p>
          <v-alert
            v-if="discordResult"
            :type="discordResult.ok ? 'success' : 'error'"
            variant="tonal"
            class="mt-4"
            data-test="alert-discord-test-result"
          >
            {{ discordResult.message }}
          </v-alert>
          <v-alert
            v-if="testDiscord.error.value || saveDiscord.error.value"
            type="error"
            variant="tonal"
            class="mt-4"
            data-test="alert-discord-error"
          >
            {{ testDiscord.error.value || saveDiscord.error.value }}
          </v-alert>
          <div v-if="auth.isAdmin" class="d-flex flex-wrap ga-2 mt-4">
            <v-btn
              variant="tonal"
              :prepend-icon="Zap"
              :loading="testDiscord.busy.value"
              :disabled="
                testDiscord.busy.value ||
                clearWebhook ||
                (!discordWebhook.trim() && !saved?.discord_webhook_set)
              "
              data-test="alert-discord-test"
              @click="testDiscord.run()"
            >
              Test webhook
            </v-btn>
            <v-btn
              v-if="saved?.discord_webhook_set && !clearWebhook"
              variant="text"
              data-test="alert-discord-remove"
              @click="removeWebhook"
            >
              Remove saved webhook
            </v-btn>
            <v-btn
              color="primary"
              :prepend-icon="Save"
              :loading="saveDiscord.busy.value"
              :disabled="saveDiscord.busy.value"
              data-test="alert-discord-save"
              @click="saveDiscord.run()"
            >
              Save Discord
            </v-btn>
          </div>
          <p
            v-if="clearWebhook"
            class="text-body-small text-warning mt-3 mb-0"
            data-test="alert-discord-remove-pending"
          >
            The saved webhook will be removed when you save.
          </p>
        </v-form>
      </SettingsCard>

      <SettingsCard
        title="Email"
        subtitle="Send alerts through your SMTP server. The test sends a message to the alert recipient."
        :icon="Mail"
      >
        <template #append>
          <v-chip
            :color="saved?.smtp_configured ? 'success' : undefined"
            variant="tonal"
            size="small"
            data-test="alert-smtp-status"
          >
            {{ saved?.smtp_configured ? 'On' : smtpEnabled ? 'Needs setup' : 'Off' }}
          </v-chip>
          <v-switch
            v-model="smtpEnabled"
            color="primary"
            inset
            hide-details
            density="compact"
            aria-label="Email alerts"
            data-test="alert-smtp-enabled"
            :disabled="!auth.isAdmin"
            @update:model-value="editedSmtp()"
          />
        </template>

        <v-form
          :readonly="!auth.isAdmin"
          data-test="alert-smtp-form"
          @submit.prevent="saveSmtp.run()"
        >
          <v-row>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="smtpHost"
                label="SMTP host"
                autocomplete="off"
                hide-details="auto"
                data-test="alert-smtp-host"
                @update:model-value="editedSmtp()"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-number-input
                v-model="smtpPort"
                label="Port"
                :min="1"
                :max="65535"
                :step="1"
                control-variant="split"
                hide-details="auto"
                data-test="alert-smtp-port"
                @update:model-value="editedSmtp()"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="smtpSecurity"
                :items="[
                  { title: 'STARTTLS', value: 'starttls' },
                  { title: 'SSL / TLS', value: 'ssl' },
                  { title: 'None', value: 'none' },
                ]"
                label="Connection security"
                hide-details
                data-test="alert-smtp-security"
                @update:model-value="editedSmtp()"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="smtpFrom"
                type="email"
                label="From address"
                autocomplete="email"
                hide-details="auto"
                data-test="alert-smtp-from"
                @update:model-value="editedSmtp()"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="smtpTo"
                type="email"
                label="Alert recipient"
                autocomplete="email"
                hide-details="auto"
                data-test="alert-smtp-to"
                @update:model-value="editedSmtp()"
              />
            </v-col>
          </v-row>

          <v-switch
            v-model="smtpAuthentication"
            color="primary"
            inset
            hide-details
            label="SMTP authentication"
            data-test="alert-smtp-authentication"
            :disabled="!auth.isAdmin"
            @update:model-value="editedSmtp()"
          />
          <p
            v-if="hasSavedSmtpCredentials && smtpAuthentication"
            class="text-body-small text-medium-emphasis mt-2 mb-0"
            data-test="alert-smtp-credentials-saved"
          >
            The username and password are saved encrypted. Leave either field blank to keep it.
          </p>
          <v-alert
            v-if="smtpAuthentication && smtpSecurity === 'none'"
            type="warning"
            variant="tonal"
            class="mt-3"
            data-test="alert-smtp-auth-tls"
          >
            SMTP authentication requires STARTTLS or SSL/TLS.
          </v-alert>
          <v-row v-if="smtpAuthentication" class="mt-1">
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="smtpUsername"
                label="SMTP username"
                autocomplete="username"
                hide-details="auto"
                data-test="alert-smtp-username"
                @update:model-value="editedSmtp()"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="smtpPassword"
                type="password"
                label="SMTP password"
                autocomplete="new-password"
                hide-details="auto"
                data-test="alert-smtp-password"
                @update:model-value="editedSmtp"
              />
            </v-col>
          </v-row>

          <v-alert
            v-if="smtpResult"
            :type="smtpResult.ok ? 'success' : 'error'"
            variant="tonal"
            class="mt-4"
            data-test="alert-smtp-test-result"
          >
            {{ smtpResult.message }}
          </v-alert>
          <v-alert
            v-if="testSmtp.error.value || saveSmtp.error.value"
            type="error"
            variant="tonal"
            class="mt-4"
            data-test="alert-smtp-error"
          >
            {{ testSmtp.error.value || saveSmtp.error.value }}
          </v-alert>
          <div v-if="auth.isAdmin" class="d-flex flex-wrap ga-2 mt-4">
            <v-btn
              variant="tonal"
              :prepend-icon="ShieldCheck"
              :loading="testSmtp.busy.value"
              :disabled="!smtpCanTest || testSmtp.busy.value"
              data-test="alert-smtp-test"
              @click="testSmtp.run()"
            >
              Test connection
            </v-btn>
            <v-btn
              color="primary"
              :prepend-icon="Save"
              :loading="saveSmtp.busy.value"
              :disabled="saveSmtp.busy.value"
              data-test="alert-smtp-save"
              @click="saveSmtp.run()"
            >
              Save email
            </v-btn>
          </div>
          <p
            v-if="!smtpAuthentication && hasSavedSmtpCredentials"
            class="text-body-small text-warning mt-3 mb-0"
            data-test="alert-smtp-remove-pending"
          >
            Saved SMTP credentials will be removed when you save.
          </p>
        </v-form>
      </SettingsCard>
    </template>
  </div>
</template>
