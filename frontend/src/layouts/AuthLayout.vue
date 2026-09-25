<script setup lang="ts">
import { Fingerprint, LockKeyhole, Server } from '@lucide/vue'

import OriginNotice from '@/components/auth/OriginNotice.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import BrandMark from '@/components/ui/BrandMark.vue'

/**
 * The frame for pages people see before they're in: sign-in, first-run setup, invitations
 * and password resets. A brand panel on wide screens, and the page's own content.
 */
withDefaults(defineProps<{ width?: number }>(), { width: 440 })

const promises = [
  {
    icon: Server,
    title: 'Yours, on your own server',
    text: 'Your finances never leave your home network.',
  },
  {
    icon: Fingerprint,
    title: 'Passkeys and two-step verification',
    text: 'Sign in with your face or fingerprint, or add a code from your phone.',
  },
  {
    icon: LockKeyhole,
    title: 'Private by design',
    text: 'Encrypted connections, strict sessions and a log of every sign-in.',
  },
]
</script>

<template>
  <div class="auth-layout">
    <aside class="auth-layout__aside" aria-label="About Cashcove">
      <div class="auth-layout__glow" aria-hidden="true" />
      <div class="auth-layout__aside-inner d-flex flex-column h-100">
        <slot name="aside">
          <BrandMark subtitle="Personal finance for your household" class="auth-layout__brand" />
          <div class="my-auto py-10">
            <h1 class="auth-layout__headline">Every account, budget and bill. Only yours.</h1>
            <ul class="auth-layout__promises mt-10">
              <li v-for="promise in promises" :key="promise.title" class="d-flex ga-4">
                <span class="auth-layout__promise-icon">
                  <v-icon :icon="promise.icon" size="20" />
                </span>
                <div>
                  <div class="text-title-small font-weight-bold">{{ promise.title }}</div>
                  <div class="text-body-small auth-layout__muted">{{ promise.text }}</div>
                </div>
              </li>
            </ul>
          </div>
          <div class="text-label-medium auth-layout__muted">Self-hosted personal finance</div>
        </slot>
      </div>
    </aside>

    <main class="auth-layout__main">
      <OriginNotice />
      <header class="d-flex align-center px-4 px-sm-8 pt-4">
        <BrandMark :size="32" class="auth-layout__mobile-brand" />
        <v-spacer />
        <ThemeToggle />
      </header>
      <div class="auth-layout__content px-4 px-sm-8 py-8" :style="{ maxWidth: `${width + 64}px` }">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth-layout {
  display: grid;
  grid-template-columns: minmax(360px, 5fr) 7fr;
  min-height: 100dvh;
}

.auth-layout__aside {
  position: relative;
  overflow: hidden;
  color: #f8fafc;
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(45, 212, 191, 0.35), transparent 60%),
    radial-gradient(90% 70% at 100% 100%, rgba(129, 140, 248, 0.4), transparent 60%),
    linear-gradient(160deg, #0f766e 0%, #134e4a 45%, #1e1b4b 100%);
}

.auth-layout__glow {
  position: absolute;
  inset: auto -20% -30% auto;
  width: 480px;
  height: 480px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(251, 191, 36, 0.25), transparent);
  filter: blur(20px);
  animation: drift 18s ease-in-out infinite alternate;
}

@keyframes drift {
  to {
    transform: translate(-60px, -80px) scale(1.15);
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-layout__glow {
    animation: none;
  }
}

.auth-layout__aside-inner {
  position: relative;
  padding: 40px 48px;
}

.auth-layout__brand :deep(.text-medium-emphasis),
.auth-layout__muted {
  color: rgba(248, 250, 252, 0.72) !important;
}

.auth-layout__headline {
  font-size: clamp(1.75rem, 2.4vw, 2.5rem);
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: -0.02em;
  max-width: 14em;
  margin: 0;
}

.auth-layout__promises {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 22px;
}

.auth-layout__promise-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.auth-layout__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: rgb(var(--v-theme-background));
}

.auth-layout__content {
  width: 100%;
  margin: auto;
}

.auth-layout__mobile-brand {
  visibility: hidden;
}

@media (max-width: 959px) {
  .auth-layout {
    grid-template-columns: 1fr;
  }

  .auth-layout__aside {
    display: none;
  }

  .auth-layout__mobile-brand {
    visibility: visible;
  }
}
</style>
