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

type Details = ActivityEntry['details']

/** What the descriptions draw on, worked out once for each entry. */
interface Context {
  entry: ActivityEntry
  details: Details
  /** Whose account it was about. */
  person: string
  /** Who made the change when it wasn't the person themselves, e.g. an admin. */
  actor: string
  /** How they signed in or confirmed it was them, e.g. "with a passkey". */
  how: string
  /** The passkey's or the person's name, for events about one. */
  name: string
  /** Done on the server with Cashcove's command line, rather than in the app. */
  fromServer: boolean
  /** Picks the wording for the log being shown. */
  say: (mine: string, theirs: string) => string
  you: string
  your: string
}

type Describe = (context: Context) => ActivityDescription

function contextOf(entry: ActivityEntry, perspective: Perspective): Context {
  const { details } = entry
  const person = entry.user_name ?? 'Someone'
  const say = (mine: string, theirs: string) => (perspective === 'self' ? mine : theirs)
  return {
    entry,
    details,
    person,
    actor: entry.actor_name && entry.actor_name !== entry.user_name ? entry.actor_name : '',
    how: METHODS[text(details.method)] ?? '',
    name: text(details.name),
    fromServer: details.via === 'command line',
    say,
    you: say('you', person),
    your: say('your', `${person}'s`),
  }
}

/** The devices someone signed out: "3 other devices", or the one they picked. */
function signedOutDevices(details: Details): string {
  const count = typeof details.count === 'number' ? details.count : 0
  if (count) return count === 1 ? '1 other device' : `${count} other devices`
  return text(details.device) || 'a device'
}

/** Which of someone's details changed: their name, their email or both. */
function changedDetails(details: Details): string {
  const changed = Array.isArray(details.changed) ? details.changed : []
  if (!changed.includes('email')) return 'name'
  return changed.includes('name') ? 'name and email' : 'email'
}

/** What an admin changed about someone's account, e.g. "made you an admin". */
function accountChanges({ details, you, your }: Context): string {
  const changes: string[] = []
  const role = ROLES[text(details.role)]
  if (role) changes.push(`made ${you} ${role}`)
  if (details.is_active === false) changes.push(`turned off ${your} account`)
  if (details.is_active === true) changes.push(`turned ${your} account back on`)
  return changes.join(' and ')
}

const DESCRIPTIONS = new Map(
  Object.entries<Describe>({
    setup_completed: ({ say, person }) => ({
      title: say('Set up Cashcove', `${person} set up Cashcove`),
      icon: PartyPopper,
      tone: 'success',
    }),
    signed_in: ({ say, person, how }) => ({
      title: join(say('Signed in', `${person} signed in`), how),
      icon: LogIn,
      tone: 'success',
    }),
    sign_in_failed: ({ entry, say, how }) => ({
      title: join(
        'Failed sign-in',
        how,
        say('', entry.user_name ? `for ${entry.user_name}` : 'for an unknown email'),
      ),
      icon: ShieldAlert,
      tone: 'error',
    }),
    verification_failed: ({ say, person, how }) => ({
      title: join(
        say("Couldn't confirm it was you", `${person} couldn't confirm it was them`),
        how,
      ),
      icon: ShieldAlert,
      tone: 'warning',
    }),
    signed_out: ({ say, person }) => ({
      title: say('Signed out', `${person} signed out`),
      icon: LogOut,
      tone: 'neutral',
    }),
    session_revoked: ({ details, say, person }) => ({
      title: join(say('Signed out', `${person} signed out`), signedOutDevices(details)),
      icon: MonitorX,
      tone: 'neutral',
    }),
    password_changed: ({ say, person }) => ({
      title: say('Changed your password', `${person} changed their password`),
      icon: KeyRound,
      tone: 'info',
    }),
    profile_updated: ({ details, say, person }) => {
      const what = changedDetails(details)
      return {
        title: say(`Changed your ${what}`, `${person} changed their ${what}`),
        icon: CircleUserRound,
        tone: 'info',
      }
    },
    two_factor_enabled: ({ say, person }) => ({
      title: say('Turned on two-step verification', `${person} turned on two-step verification`),
      icon: ShieldCheck,
      tone: 'success',
    }),
    two_factor_disabled: ({ say, person }) => ({
      title: say('Turned off two-step verification', `${person} turned off two-step verification`),
      icon: ShieldOff,
      tone: 'warning',
    }),
    two_factor_reset: ({ fromServer, actor, you, your }) => ({
      title: fromServer
        ? `Two-step verification was turned off for ${you} on the server`
        : join(actor || 'An admin', 'turned off', your, 'two-step verification'),
      icon: ShieldOff,
      tone: 'warning',
    }),
    recovery_codes_created: ({ say, person }) => ({
      title: say('Created new recovery codes', `${person} created new recovery codes`),
      icon: LifeBuoy,
      tone: 'info',
    }),
    recovery_code_used: ({ details, say, person }) => ({
      title: join(
        say('Signed in', `${person} signed in`),
        'with a recovery code',
        typeof details.codes_left === 'number' ? `(${details.codes_left} left)` : '',
      ),
      icon: LifeBuoy,
      tone: 'warning',
    }),
    passkey_added: ({ say, person, name }) => ({
      title: join(say('Added a passkey', `${person} added a passkey`), name && `· ${name}`),
      icon: KeySquare,
      tone: 'success',
    }),
    passkey_removed: ({ say, person, name }) => ({
      title: join(say('Removed a passkey', `${person} removed a passkey`), name && `· ${name}`),
      icon: KeySquare,
      tone: 'neutral',
    }),
    user_invited: ({ details, actor, person }) => {
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
    },
    invitation_revoked: ({ details, actor, person }) => ({
      title: join(actor || person, 'cancelled the invitation for', text(details.email)),
      icon: Ban,
      tone: 'neutral',
    }),
    invitation_accepted: ({ say, person }) => ({
      title: say('Joined the household', `${person} joined the household`),
      icon: UserCheck,
      tone: 'success',
    }),
    user_updated: (context) => {
      const turnedOff = context.details.is_active === false
      return {
        title: join(
          context.actor || 'An admin',
          accountChanges(context) || `updated ${context.your} account`,
        ),
        icon: turnedOff ? UserX : UserCog,
        tone: turnedOff ? 'warning' : 'info',
      }
    },
    user_removed: ({ details, actor, person, name }) => ({
      title: join(actor || person, 'removed', name || text(details.email) || 'someone'),
      icon: UserMinus,
      tone: 'warning',
    }),
    password_reset_created: ({ fromServer, actor, you }) => ({
      title: fromServer
        ? `A password reset link was created for ${you} on the server`
        : join(actor || 'An admin', 'created a password reset link for', you),
      icon: KeyRound,
      tone: 'info',
    }),
    password_reset: ({ say, person }) => ({
      title: say(
        'Chose a new password with a reset link',
        `${person} chose a new password with a reset link`,
      ),
      icon: KeyRound,
      tone: 'info',
    }),
  }),
)

export function describeActivity(
  entry: ActivityEntry,
  perspective: Perspective = 'self',
): ActivityDescription {
  const describe = DESCRIPTIONS.get(entry.event)
  if (!describe) return { title: entry.event.replaceAll('_', ' '), icon: History, tone: 'neutral' }
  return describe(contextOf(entry, perspective))
}
