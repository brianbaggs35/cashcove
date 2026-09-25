import { Secret, TOTP } from 'otpauth'

/**
 * The 6-digit code an authenticator app shows for `secret` now, or `stepsAhead` 30-second
 * steps later. Cashcove accepts each code once, so a second sign-in within the same 30
 * seconds needs `{ stepsAhead: 1 }` (it allows one step of clock drift).
 */
export function totpCode(secret: string, { stepsAhead = 0 }: { stepsAhead?: number } = {}): string {
  const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 })
  return totp.generate({ timestamp: Date.now() + stepsAhead * 30_000 })
}
