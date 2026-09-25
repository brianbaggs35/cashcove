"""Passkeys (WebAuthn): phishing-resistant sign-in bound to Cashcove's own address."""

import hmac
import json
from collections.abc import Sequence
from typing import Any, cast

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.authentication.verify_authentication_response import VerifiedAuthentication
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, generate_challenge
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidJSONStructure,
    InvalidRegistrationResponse,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)
from webauthn.registration.verify_registration_response import VerifiedRegistration

from app.config import Settings
from app.models import Passkey, User

RP_NAME = "Cashcove"
TIMEOUT_MS = 120_000

# Passkey providers identify themselves with an AAGUID; these are the common ones, used to
# give a new passkey a recognisable name. Anything else is named after the browser.
KNOWN_PROVIDERS = {
    "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
    "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
    "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
    "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
    "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
    "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
    "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
    "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
    "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
    "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
}

_TRANSPORTS = {transport.value for transport in AuthenticatorTransport}

# Everything the library raises for a response that doesn't verify or doesn't parse.
VERIFICATION_ERRORS = (
    InvalidAuthenticationResponse,
    InvalidRegistrationResponse,
    InvalidJSONStructure,
    ValueError,
    KeyError,
    TypeError,
)


def _to_json(options: Any) -> dict[str, Any]:
    parsed: dict[str, Any] = json.loads(options_to_json(options))
    return parsed


def _descriptor(passkey: Passkey) -> PublicKeyCredentialDescriptor:
    return PublicKeyCredentialDescriptor(
        id=passkey.credential_id,
        transports=[AuthenticatorTransport(value) for value in passkey.transports],
    )


def registration_options(
    settings: Settings, user: User, existing: Sequence[Passkey]
) -> tuple[bytes, dict[str, Any]]:
    """A new challenge and the options for navigator.credentials.create()."""
    challenge = generate_challenge()
    options = generate_registration_options(
        rp_id=settings.server_name,
        rp_name=RP_NAME,
        user_id=user.webauthn_id,
        user_name=user.email,
        user_display_name=user.name,
        challenge=challenge,
        timeout=TIMEOUT_MS,
        # A discoverable credential lets people sign in without typing their email first.
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[_descriptor(passkey) for passkey in existing],
    )
    return challenge, _to_json(options)


def verify_registration(
    settings: Settings, credential: dict[str, Any], challenge: bytes
) -> VerifiedRegistration:
    return verify_registration_response(
        credential=credential,
        expected_challenge=challenge,
        expected_rp_id=settings.server_name,
        expected_origin=settings.public_origin,
        require_user_verification=True,
    )


def _response(credential: dict[str, Any]) -> dict[str, object]:
    response: object = credential.get("response")
    return cast(dict[str, object], response) if isinstance(response, dict) else {}


def credential_transports(credential: dict[str, Any]) -> list[str]:
    transports = _response(credential).get("transports")
    if not isinstance(transports, list):
        return []
    values = cast(list[object], transports)
    return [value for value in values if isinstance(value, str) and value in _TRANSPORTS]


def authentication_options(
    settings: Settings, allowed: Sequence[Passkey] = ()
) -> tuple[bytes, dict[str, Any]]:
    """Options for navigator.credentials.get(). With nothing allowed, any passkey may answer."""
    challenge = generate_challenge()
    options = generate_authentication_options(
        rp_id=settings.server_name,
        challenge=challenge,
        timeout=TIMEOUT_MS,
        allow_credentials=[_descriptor(passkey) for passkey in allowed],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    return challenge, _to_json(options)


def verify_authentication(
    settings: Settings, credential: dict[str, Any], challenge: bytes, passkey: Passkey
) -> VerifiedAuthentication:
    return verify_authentication_response(
        credential=credential,
        expected_challenge=challenge,
        expected_rp_id=settings.server_name,
        expected_origin=settings.public_origin,
        credential_public_key=passkey.public_key,
        credential_current_sign_count=passkey.sign_count,
        require_user_verification=True,
    )


def provider_name(aaguid: str) -> str | None:
    return KNOWN_PROVIDERS.get(aaguid)


def encode_challenge(challenge: bytes) -> str:
    return bytes_to_base64url(challenge)


def encode_id(value: bytes) -> str:
    """A credential or user ID the way browsers write it, e.g. for the WebAuthn Signal API."""
    return bytes_to_base64url(value)


def decode_challenge(value: object) -> bytes | None:
    return _decode(value)


def credential_id(credential: dict[str, Any]) -> bytes | None:
    """The ID of the passkey that answered, so its public key can be looked up."""
    return _decode(credential.get("rawId"))


def user_handle_matches(credential: dict[str, Any], webauthn_id: bytes) -> bool:
    """A discoverable passkey names the account it belongs to; it must be the expected one."""
    handle = _response(credential).get("userHandle")
    if handle is None:
        return True
    decoded = _decode(handle)
    return decoded is not None and hmac.compare_digest(decoded, webauthn_id)


def _decode(value: object) -> bytes | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return base64url_to_bytes(value)
    except ValueError:
        return None
