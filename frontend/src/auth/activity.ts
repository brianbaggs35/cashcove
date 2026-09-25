import {
  Ban,
  CircleUserRound,
  History,
  KeyRound,
  KeySquare,
  LifeBuoy,
  LogIn,
  LogOut,
  MailPlus,
  MonitorX,
  PartyPopper,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserCog,
  UserMinus,
  UserX,
  type LucideIcon,
} from '@lucide/vue'

import type { ActivityEntry } from '@/api/account'

export type ActivityTone = 'success' | 'error' | 'warning' | 'info' | 'neutral'

export interface ActivityDescription {
  title: string
  icon: LucideIcon
  tone: ActivityTone
}

/**
 * `self` is someone's own log ("Signed in with a passkey"); `household` is the admin's log of
 * everyone, so each line says who it was about ("Sam Lee signed in with a passkey").
 */
export type Perspective = 'self' | 'household'

const METHODS: Record<string, string> = {
  password: 'with a password',
  passkey: 'with a passkey',
  totp: 'with an authenticator code',
  recovery_code: 'with a recovery code',
}

const ROLES: Record<string, string> = { admin: 'an admin', viewer: 'a viewer' }

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join(' ')
}

export function describeActivity(
  entry: ActivityEntry,
  perspective: Perspective = 'self',
): ActivityDescription {
  const { details } = entry
  const self = perspective === 'self'
  const person = entry.user_name ?? 'Someone'
  // Who made the change when it wasn't the person themselves, e.g. an admin.
  const actor = entry.actor_name && entry.actor_name !== entry.user_name ? entry.actor_name : ''
  const fromServer = details.via === 'command line'
  const how = METHODS[text(details.method)] ?? ''
  const name = text(details.name)
  // Picks the wording for the log being shown.
  const say = (mine: string, theirs: string) => (self ? mine : theirs)
  const you = say('you', person)
  const your = say('your', `${person}'s`)

  switch (entry.event) {
    case 'setup_completed':
      return {
        title: say('Set up Cashcove', `${person} set up Cashcove`),
        icon: PartyPopper,
        tone: 'success',
      }
    case 'signed_in':
      return {
        title: join(say('Signed in', `${person} signed in`), how),
        icon: LogIn,
        tone: 'success',
      }
    case 'sign_in_failed': {
      const target = entry.user_name ? `for ${entry.user_name}` : 'for an unknown email'
      return {
        title: join('Failed sign-in', how, say('', target)),
        icon: ShieldAlert,
        tone: 'error',
      }
    }
    case 'verification_failed':
      return {
        title: join(
          say("Couldn't confirm it was you", `${person} couldn't confirm it was them`),
          how,
        ),
        icon: ShieldAlert,
        tone: 'warning',
      }
    case 'signed_out':
      return { title: say('Signed out', `${person} signed out`), icon: LogOut, tone: 'neutral' }
    case 'session_revoked': {
      const count = typeof details.count === 'number' ? details.count : 0
      const devices = count === 1 ? '1 other device' : `${count} other devices`
      const what = count ? devices : text(details.device) || 'a device'
      return {
        title: join(say('Signed out', `${person} signed out`), what),
        icon: MonitorX,
        tone: 'neutral',
      }
    }
    case 'password_changed':
      return {
        title: say('Changed your password', `${person} changed their password`),
        icon: KeyRound,
        tone: 'info',
      }
    case 'profile_updated': {
      const changed = Array.isArray(details.changed) ? details.changed : []
      const email = changed.includes('email')
      const what = email ? (changed.includes('name') ? 'name and email' : 'email') : 'name'
      return {
        title: say(`Changed your ${what}`, `${person} changed their ${what}`),
        icon: CircleUserRound,
        tone: 'info',
      }
    }
    case 'two_factor_enabled':
      return {
        title: say('Turned on two-step verification', `${person} turned on two-step verification`),
        icon: ShieldCheck,
        tone: 'success',
      }
    case 'two_factor_disabled':
      return {
        title: say(
          'Turned off two-step verification',
          `${person} turned off two-step verification`,
        ),
        icon: ShieldOff,
        tone: 'warning',
      }
    case 'two_factor_reset':
      return {
        title: fromServer
          ? `Two-step verification was turned off for ${you} on the server`
          : join(actor || 'An admin', 'turned off', your, 'two-step verification'),
        icon: ShieldOff,
        tone: 'warning',
      }
    case 'recovery_codes_created':
      return {
        title: say('Created new recovery codes', `${person} created new recovery codes`),
        icon: LifeBuoy,
        tone: 'info',
      }
    case 'recovery_code_used': {
      const left = typeof details.codes_left === 'number' ? `(${details.codes_left} left)` : ''
      return {
        title: join(say('Signed in', `${person} signed in`), 'with a recovery code', left),
        icon: LifeBuoy,
        tone: 'warning',
      }
    }
    case 'passkey_added':
      return {
        title: join(say('Added a passkey', `${person} added a passkey`), name && `· ${name}`),
        icon: KeySquare,
        tone: 'success',
      }
    case 'passkey_removed':
      return {
        title: join(say('Removed a passkey', `${person} removed a passkey`), name && `· ${name}`),
        icon: KeySquare,
        tone: 'neutral',
      }
    case 'user_invited': {
      const role = ROLES[text(details.role)]
      return {
        title: join(
          actor || person,
          details.renewed ? 'sent a new invitation link to' : 'invited',
          text(details.email),
          role ? `as ${role}` : '',
        ),
        icon: MailPlus,
        tone: 'info',
      }
    }
    case 'invitation_revoked':
      return {
        title: join(actor || person, 'cancelled the invitation for', text(details.email)),
        icon: Ban,
        tone: 'neutral',
      }
    case 'invitation_accepted':
      return {
        title: say('Joined the household', `${person} joined the household`),
        icon: UserCheck,
        tone: 'success',
      }
    case 'user_updated': {
      const changes: string[] = []
      const role = ROLES[text(details.role)]
      if (role) changes.push(`made ${you} ${role}`)
      if (details.is_active === false) changes.push(`turned off ${your} account`)
      if (details.is_active === true) changes.push(`turned ${your} account back on`)
      const turnedOff = details.is_active === false
      return {
        title: join(actor || 'An admin', changes.join(' and ') || `updated ${your} account`),
        icon: turnedOff ? UserX : UserCog,
        tone: turnedOff ? 'warning' : 'info',
      }
    }
    case 'user_removed':
      return {
        title: join(actor || person, 'removed', name || text(details.email) || 'someone'),
        icon: UserMinus,
        tone: 'warning',
      }
    case 'password_reset_created':
      return {
        title: fromServer
          ? `A password reset link was created for ${you} on the server`
          : join(actor || 'An admin', 'created a password reset link for', you),
        icon: KeyRound,
        tone: 'info',
      }
    case 'password_reset':
      return {
        title: say(
          'Chose a new password with a reset link',
          `${person} chose a new password with a reset link`,
        ),
        icon: KeyRound,
        tone: 'info',
      }
    default:
      return { title: entry.event.replaceAll('_', ' '), icon: History, tone: 'neutral' }
  }
}
