"""A software passkey, so tests can register and sign in with real WebAuthn responses."""

import hashlib
import json
import secrets
import struct
from dataclasses import dataclass, field
from typing import Any

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url

from tests.helpers import ORIGIN, SERVER_NAME

USER_PRESENT = 0x01
USER_VERIFIED = 0x04
BACKUP_ELIGIBLE = 0x08
BACKED_UP = 0x10
ATTESTED = 0x40

ICLOUD_KEYCHAIN = bytes.fromhex("fbfc3007154e4ecc8c0b6e020557d7bd")


def _new_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@dataclass
class Authenticator:
    """Answers navigator.credentials.create() and get() the way a browser would."""

    aaguid: bytes = bytes(16)
    origin: str = ORIGIN
    rp_id: str = SERVER_NAME
    credential_id: bytes = field(default_factory=lambda: secrets.token_bytes(32))
    key: ec.EllipticCurvePrivateKey = field(default_factory=_new_key)
    user_handle: bytes | None = None
    sign_count: int = 0

    @property
    def id(self) -> str:
        return bytes_to_base64url(self.credential_id)

    def _client_data(self, kind: str, options: dict[str, Any]) -> bytes:
        return json.dumps(
            {
                "type": kind,
                "challenge": options["challenge"],
                "origin": self.origin,
                "crossOrigin": False,
            }
        ).encode()

    def _authenticator_data(self, *, attested: bool, verified: bool) -> bytes:
        flags = USER_PRESENT | BACKUP_ELIGIBLE | BACKED_UP
        if verified:
            flags |= USER_VERIFIED
        if attested:
            flags |= ATTESTED
        data = (
            hashlib.sha256(self.rp_id.encode()).digest()
            + bytes([flags])
            + struct.pack(">I", self.sign_count)
        )
        if attested:
            numbers = self.key.public_key().public_numbers()
            public_key = cbor2.dumps(
                {
                    1: 2,  # EC2 key
                    3: -7,  # ES256
                    -1: 1,  # P-256
                    -2: numbers.x.to_bytes(32, "big"),
                    -3: numbers.y.to_bytes(32, "big"),
                }
            )
            data += (
                self.aaguid
                + struct.pack(">H", len(self.credential_id))
                + self.credential_id
                + public_key
            )
        return data

    def create(self, options: dict[str, Any]) -> dict[str, Any]:
        """A new passkey for the account in ``options``, with "none" attestation."""
        self.user_handle = base64url_to_bytes(options["user"]["id"])
        attestation = cbor2.dumps(
            {
                "fmt": "none",
                "attStmt": {},
                "authData": self._authenticator_data(attested=True, verified=True),
            }
        )
        return {
            "id": self.id,
            "rawId": self.id,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(self._client_data("webauthn.create", options)),
                "attestationObject": bytes_to_base64url(attestation),
                "transports": ["internal", "hybrid", "carrier-pigeon"],
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }

    def get(self, options: dict[str, Any], *, verified: bool = True) -> dict[str, Any]:
        """A signed answer to a sign-in challenge."""
        self.sign_count += 1
        client_data = self._client_data("webauthn.get", options)
        authenticator_data = self._authenticator_data(attested=False, verified=verified)
        signature = self.key.sign(
            authenticator_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "id": self.id,
            "rawId": self.id,
            "type": "public-key",
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "authenticatorData": bytes_to_base64url(authenticator_data),
                "signature": bytes_to_base64url(signature),
                "userHandle": bytes_to_base64url(self.user_handle) if self.user_handle else None,
            },
            "clientExtensionResults": {},
            "authenticatorAttachment": "platform",
        }
