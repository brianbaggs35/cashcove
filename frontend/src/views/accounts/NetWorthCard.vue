<script setup lang="ts">
import { Scale } from '@lucide/vue'
import { computed } from 'vue'

import type { Account } from '@/api/accounts'
import { useHousehold } from '@/composables/useHousehold'
import { netWorth } from '@/views/accounts/totals'
import { toCents } from '@/utils/money'

/**
 * What the household has, what it owes, and the difference, across its open accounts. Whatever
 * is put in the slot goes under the figures.
 */
const props = defineProps<{ accounts: Account[] }>()

const { currency, money } = useHousehold()
const totals = computed(() => netWorth(props.accounts, currency.value))
const main = computed(() => totals.value.main)
const others = computed(() => totals.value.others)

/** How the bar splits between assets and what's owed. */
const share = computed(() => {
  const assets = Math.max(0, toCents(main.value.assets))
  const owed = Math.max(0, toCents(main.value.liabilities))
  return assets + owed === 0 ? 100 : Math.round((assets / (assets + owed)) * 100)
})
</script>

<template>
  <v-card class="net-worth pa-5 pa-md-6" data-test="net-worth">
    <div class="net-worth__glow" aria-hidden="true" />
    <div class="position-relative">
      <div class="d-flex align-center ga-2 text-label-large text-medium-emphasis">
        <v-icon :icon="Scale" size="18" />
        Net worth
      </div>
      <div
        class="net-worth__total text-display-small font-weight-bold tabular-nums mt-1"
        data-test="net-worth-total"
      >
        {{ money(main.net, main.currency) }}
      </div>

      <svg
        class="net-worth__bar mt-4"
        role="img"
        :aria-label="`Assets ${share}%, owed ${100 - share}%`"
        width="100%"
        height="10"
      >
        <rect class="net-worth__assets" :width="`${share}%`" height="10" />
      </svg>
      <div class="d-flex flex-wrap ga-6 mt-3">
        <div>
          <div class="d-flex align-center ga-2 text-label-medium text-medium-emphasis">
            <span class="net-worth__dot net-worth__dot--assets" aria-hidden="true" />
            Assets
          </div>
          <div class="text-title-medium font-weight-bold tabular-nums" data-test="net-worth-assets">
            {{ money(main.assets, main.currency) }}
          </div>
        </div>
        <div>
          <div class="d-flex align-center ga-2 text-label-medium text-medium-emphasis">
            <span class="net-worth__dot net-worth__dot--owed" aria-hidden="true" />
            Owed
          </div>
          <div class="text-title-medium font-weight-bold tabular-nums" data-test="net-worth-owed">
            {{ money(main.liabilities, main.currency) }}
          </div>
        </div>
      </div>
      <p
        v-if="others.length"
        class="text-body-small text-medium-emphasis mt-4 mb-0"
        data-test="net-worth-other"
      >
        Accounts in other currencies aren't converted:
        <template v-for="(other, index) in others" :key="other.currency">
          <template v-if="index">, </template>
          <span class="tabular-nums">{{ money(other.net, other.currency) }}</span> net in
          {{ other.currency }}
        </template>
      </p>
      <slot />
    </div>
  </v-card>
</template>

<style scoped>
.net-worth {
  position: relative;
  overflow: hidden;
}

.net-worth__glow {
  position: absolute;
  inset: -60% -20% auto auto;
  width: 420px;
  height: 320px;
  background: radial-gradient(
    closest-side,
    rgba(var(--v-theme-primary), 0.14),
    rgba(var(--v-theme-secondary), 0.06),
    transparent
  );
  pointer-events: none;
}

.net-worth__total {
  letter-spacing: -0.02em;
}

.net-worth__bar {
  display: block;
  border-radius: 999px;
  overflow: hidden;
  background: rgb(var(--v-theme-warning));
}

.net-worth__assets {
  fill: rgb(var(--v-theme-primary));
}

.net-worth__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.net-worth__dot--assets {
  background: rgb(var(--v-theme-primary));
}

.net-worth__dot--owed {
  background: rgb(var(--v-theme-warning));
}
</style>
