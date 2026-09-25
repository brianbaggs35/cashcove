import type { LucideIcon } from '@lucide/vue'
import { shallowRef } from 'vue'

export interface ConfirmOptions {
  title: string
  text?: string
  /** Label for the confirming button, which should say what it does, e.g. "Remove passkey". */
  confirmText?: string
  cancelText?: string
  /** `error` for changes that can't be undone or take something away. */
  tone?: 'primary' | 'error' | 'warning'
  icon?: LucideIcon
  /**
   * Runs when the person confirms, while the button shows progress. If it fails, the dialog
   * stays open with the error so they can try again or cancel.
   */
  action?: () => Promise<unknown>
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

/** The confirmation being asked right now, shown by ConfirmDialogHost. */
export const confirmRequest = shallowRef<ConfirmRequest | null>(null)

/** Asks the person to confirm; resolves true once they did (and the action, if any, succeeded). */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  confirmRequest.value?.resolve(false)
  return new Promise((resolve) => {
    confirmRequest.value = {
      ...options,
      resolve: (confirmed) => {
        confirmRequest.value = null
        resolve(confirmed)
      },
    }
  })
}

/**
 * Asks for confirmation and runs `action` while the dialog shows progress. Resolves to what the
 * action returned, or null when the person cancelled.
 */
export async function confirmAndRun<T>(
  options: Omit<ConfirmOptions, 'action'>,
  action: () => Promise<T>,
): Promise<{ result: T } | null> {
  let outcome: { result: T } | null = null
  const confirmed = await confirm({
    ...options,
    action: async () => {
      outcome = { result: await action() }
    },
  })
  return confirmed ? outcome : null
}
