<script setup lang="ts">
import { Cloud, Fingerprint, MonitorSmartphone, Pencil, Plus, Trash2 } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import { fetchPasskeys, removePasskey, renamePasskey, type Passkey } from '@/api/account'
import type { User } from '@/api/auth'
import { addPasskeyToAccount } from '@/auth/passkeyFlows'
import { signalCurrentPasskeys } from '@/auth/passkeys'
import AppDialog from '@/components/ui/AppDialog.vue'
import RelativeTime from '@/components/ui/RelativeTime.vue'
import { confirm } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useAuthStore } from '@/stores/auth'
import { formatShortDate } from '@/utils/format'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const props = defineProps<{ user: User }>()
const emit = defineEmits<{ changed: [] }>()

const auth = useAuthStore()
const passkeys = ref<Passkey[]>([])
const loaded = ref(false)

/** Keeps the account's passkey count in step, and tells the password manager which are current. */
function listChanged() {
  auth.updateUser({ passkey_count: passkeys.value.length })
  const ids = passkeys.value.map((passkey) => passkey.credential_id)
  void signalCurrentPasskeys(auth.origin, props.user.webauthn_user_id, ids)
}

const loading = useAction(async () => {
  passkeys.value = await fetchPasskeys()
  loaded.value = true
  listChanged()
})

const errors = computed(() =>
  [adding.error.value, loading.error.value].filter((message) => message !== null),
)

/** Why a passkey can't be added from here, when it can't. */
const unavailable = computed(() => {
  if (auth.passkeysAvailable) return null
  if (auth.state?.passkeys_supported !== true) {
    return 'Passkeys need Cashcove to be set up with a domain name rather than an IP address.'
  }
  if (auth.wrongOrigin)
    return `Passkeys only work at ${auth.origin}. Open Cashcove there to add one.`
  return "This browser can't use passkeys. Try an up-to-date Chrome, Edge, Firefox or Safari."
})

const adding = useAction(async () => {
  const passkey = await addPasskeyToAccount()
  if (!passkey) return
  passkeys.value = [...passkeys.value, passkey]
  listChanged()
  notify(`Added ${passkey.name}. You can sign in with it now.`)
  emit('changed')
})

// ---- Renaming ----

const renameOpen = ref(false)
const renaming = ref<Passkey | null>(null)
const newName = ref('')
const nameRules = [
  (value: string) => value.trim().length > 0 || 'Give it a name',
  (value: string) => value.trim().length <= 80 || 'Keep it under 80 characters',
]
const canRename = computed(
  () => newName.value.trim().length > 0 && newName.value.trim().length <= 80,
)

function startRename(passkey: Passkey) {
  renaming.value = passkey
  newName.value = passkey.name
  saving.clear()
  renameOpen.value = true
}

const saving = useAction(async (passkey: Passkey) => {
  const updated = await renamePasskey(passkey.id, newName.value.trim())
  passkeys.value = passkeys.value.map((item) => (item.id === updated.id ? updated : item))
  renameOpen.value = false
  notify('Passkey renamed')
})

function saveName() {
  if (renaming.value && canRename.value) void saving.run(renaming.value)
}

// ---- Removing ----

async function remove(passkey: Passkey) {
  const lastWayIn = passkeys.value.length === 1 && !props.user.totp_enabled
  const removed = await confirm({
    title: `Remove ${passkey.name}?`,
    text: lastWayIn
      ? "You won't be able to sign in with this passkey anymore, and your password alone will get you in. Consider adding another passkey or an authenticator app."
      : "You won't be able to sign in with this passkey anymore. Cashcove also asks your password manager to forget it.",
    confirmText: 'Remove passkey',
    tone: 'error',
    icon: Trash2,
    action: () => removePasskey(passkey.id),
  })
  if (!removed) return
  passkeys.value = passkeys.value.filter((item) => item.id !== passkey.id)
  listChanged()
  notify(`Removed ${passkey.name}`)
  emit('changed')
}

onMounted(() => void loading.run())
</script>

<template>
  <SettingsCard
    id="passkeys"
    title="Passkeys"
    subtitle="Sign in with your fingerprint, face or screen lock. Nothing to type, and nothing anyone can phish or guess."
    :icon="Fingerprint"
  >
    <template v-if="!unavailable" #action>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Plus"
        :loading="adding.busy.value"
        data-test="passkey-add"
        @click="adding.run()"
      >
        Add a passkey
      </v-btn>
    </template>

    <v-alert
      v-if="unavailable"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="unavailable"
      data-test="passkey-unavailable"
    />
    <v-alert
      v-for="message in errors"
      :key="message"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="message"
      data-test="passkey-error"
    />

    <v-skeleton-loader
      v-if="!loaded && loading.busy.value"
      type="list-item-avatar-two-line@2"
      data-test="passkeys-loading"
    />
    <v-list v-else-if="passkeys.length" bg-color="transparent" class="pa-0" lines="three">
      <v-list-item
        v-for="passkey in passkeys"
        :key="passkey.id"
        class="px-0 passkey"
        data-test="passkey"
      >
        <template #prepend>
          <v-avatar color="primary" variant="tonal" rounded="lg" size="44">
            <v-icon :icon="Fingerprint" size="22" />
          </v-avatar>
        </template>
        <v-list-item-title class="font-weight-bold">{{ passkey.name }}</v-list-item-title>
        <div class="text-body-small text-medium-emphasis mt-1">
          Added {{ formatShortDate(new Date(passkey.created_at)) }} ·
          <template v-if="passkey.last_used_at">
            Last used <RelativeTime :value="passkey.last_used_at" />
          </template>
          <template v-else>Not used yet</template>
        </div>
        <div class="d-flex flex-wrap ga-1 mt-2">
          <v-chip
            v-if="passkey.provider && passkey.provider !== passkey.name"
            size="x-small"
            variant="tonal"
            data-test="passkey-provider"
          >
            {{ passkey.provider }}
          </v-chip>
          <v-chip
            v-tooltip:top="
              passkey.backed_up
                ? 'Saved in your password manager, so it works on your other devices too.'
                : 'Only works on the device or security key that holds it.'
            "
            :prepend-icon="passkey.backed_up ? Cloud : MonitorSmartphone"
            size="x-small"
            variant="tonal"
            :color="passkey.backed_up ? 'success' : undefined"
            data-test="passkey-sync"
          >
            {{ passkey.backed_up ? 'Synced' : 'This device only' }}
          </v-chip>
        </div>
        <template #append>
          <div class="d-flex ga-1">
            <v-btn
              :icon="Pencil"
              variant="text"
              size="small"
              :aria-label="`Rename ${passkey.name}`"
              data-test="passkey-rename"
              @click="startRename(passkey)"
            />
            <v-btn
              :icon="Trash2"
              variant="text"
              size="small"
              color="error"
              :aria-label="`Remove ${passkey.name}`"
              data-test="passkey-remove"
              @click="remove(passkey)"
            />
          </div>
        </template>
      </v-list-item>
    </v-list>
    <div
      v-else-if="loaded"
      class="passkeys-empty d-flex align-center ga-4 pa-4"
      data-test="passkeys-empty"
    >
      <v-icon :icon="Fingerprint" size="28" class="text-medium-emphasis" />
      <div class="text-body-medium text-medium-emphasis">
        You don't have any passkeys yet. Add one on each device you use, or save one to your
        password manager so it follows you everywhere.
      </div>
    </div>
  </SettingsCard>

  <AppDialog
    v-model="renameOpen"
    title="Rename passkey"
    subtitle="Pick a name that tells you where it's saved, like “Work laptop” or “iPhone”."
    :icon="Pencil"
    :persistent="saving.busy.value"
    max-width="460"
  >
    <v-form @submit.prevent="saveName">
      <v-text-field
        v-model="newName"
        label="Name"
        counter="80"
        autofocus
        :rules="nameRules"
        :error-messages="saving.error.value ?? undefined"
        data-test="passkey-name"
      />
    </v-form>
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="renameOpen = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        :disabled="!canRename"
        data-test="passkey-name-save"
        @click="saveName"
      >
        Save
      </v-btn>
    </template>
  </AppDialog>
</template>

<style scoped>
.passkey + .passkey {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.passkeys-empty {
  border-radius: 16px;
  border: 1px dashed rgba(var(--v-border-color), 0.3);
}
</style>
