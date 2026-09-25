import type { ActivityEntry } from '@/api/account'
import type { Role } from '@/api/auth'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'

/** How someone signs in; only admins see this about other people. */
export interface MemberDetails {
  totp_enabled: boolean
  passkey_count: number
  last_sign_in_at: string | null
}

export interface Member {
  id: string
  email: string
  name: string
  role: Role
  is_active: boolean
  created_at: string
  details: MemberDetails | null
}

export interface Invitation {
  id: string
  email: string
  name: string
  role: Role
  invited_by: string | null
  created_at: string
  expires_at: string
}

/** The link is only ever shown once: Cashcove keeps just a hash of it. */
export interface InvitationLink {
  invitation: Invitation
  link: string
}

export interface ResetLink {
  link: string
  expires_at: string
}

export interface MemberChanges {
  role?: Role
  is_active?: boolean
}

export const fetchMembers = () => apiGet<Member[]>('/users')
export const updateMember = (id: string, changes: MemberChanges) =>
  apiPatch<Member>(`/users/${id}`, changes)
export const removeMember = (id: string) => apiDelete(`/users/${id}`)
export const createResetLink = (id: string) => apiPost<ResetLink>(`/users/${id}/password-reset`)
export const resetTwoFactor = (id: string) => apiDelete(`/users/${id}/two-factor`)
export const fetchHouseholdActivity = (limit = 100) =>
  apiGet<ActivityEntry[]>(`/users/activity?limit=${limit}`)

export const fetchInvitations = () => apiGet<Invitation[]>('/users/invitations')
export const inviteMember = (name: string, email: string, role: Role) =>
  apiPost<InvitationLink>('/users/invitations', { name, email, role })
export const renewInvitation = (id: string) =>
  apiPost<InvitationLink>(`/users/invitations/${id}/link`)
export const revokeInvitation = (id: string) => apiDelete(`/users/invitations/${id}`)
