import type { Page } from '@playwright/test'

import type { BaselinePasskey } from './harness'

/** Chrome DevTools takes binary values as standard base64; the API sends base64url. */
function base64(value: string): string {
  return Buffer.from(value, 'base64url').toString('base64')
}

/**
 * Gives the page's browser a virtual authenticator holding a baseline passkey, so "Sign in
 * with a passkey" and passkey checks work without a real device. It confirms each use as if
 * someone touched the fingerprint reader. Chromium only; call it before opening the page.
 *
 * A person picks a passkey from the email field's autofill menu, but the virtual authenticator
 * answers the sign-in page's autofill request at once, signing in as the page opens. So the
 * page is told the browser has no passkey autofill, unless `autofill` is true.
 */
export async function addPasskey(
  page: Page,
  passkey: BaselinePasskey,
  { autofill = false }: { autofill?: boolean } = {},
): Promise<void> {
  if (!autofill) {
    await page.addInitScript(() => {
      PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
    })
  }
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('WebAuthn.enable')
  const { authenticatorId } = await devtools.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  await devtools.send('WebAuthn.addCredential', {
    authenticatorId,
    credential: {
      credentialId: base64(passkey.credential_id),
      isResidentCredential: true,
      rpId: passkey.rp_id,
      privateKey: base64(passkey.private_key),
      userHandle: base64(passkey.user_handle),
      // The API turns away a passkey whose use count went backwards, a sign it was copied.
      // Counting from the time keeps each new browser ahead of the last one, reset or not.
      signCount: Math.floor(Date.now() / 1000),
    },
  })
}
