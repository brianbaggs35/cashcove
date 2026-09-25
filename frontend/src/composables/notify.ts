import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from '@lucide/vue'
import { ref } from 'vue'

export type NoticeTone = 'success' | 'error' | 'info' | 'warning'

export interface Notice {
  id: number
  text: string
  tone: NoticeTone
  icon: LucideIcon
  timeout: number
}

const icons: Record<NoticeTone, LucideIcon> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
  warning: TriangleAlert,
}

let nextId = 1

/** Toasts waiting to be shown, oldest first. NotificationHost shows them one at a time. */
export const notices = ref<Notice[]>([])

/** Shows a short message at the bottom of the screen. Errors stay up a little longer. */
export function notify(text: string, tone: NoticeTone = 'success'): void {
  notices.value.push({
    id: nextId++,
    text,
    tone,
    icon: icons[tone],
    timeout: tone === 'error' ? 6000 : 4000,
  })
}
