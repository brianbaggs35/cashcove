"""Encryption for secrets Cashcove must keep but never reveal, such as authenticator keys."""

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

VERSION = "v1"


class DecryptionError(Exception):
    """The value was tampered with, or was encrypted under a different secret key."""


class SecretBox:
    """AES-256-GCM with a key derived from the app secret for one purpose.

    Separate purposes get separate keys, and the purpose is bound into every ciphertext,
    so a value encrypted for one use can't be passed off as another.
    """

    def __init__(self, secret_key: bytes, *, purpose: str) -> None:
        self._purpose = purpose.encode()
        key = HKDF(
            algorithm=hashes.SHA256(), length=32, salt=None, info=b"cashcove:" + self._purpose
        ).derive(secret_key)
        self._aead = AESGCM(key)

    def encrypt(self, plaintext: str) -> str:
        nonce = os.urandom(12)
        sealed = self._aead.encrypt(nonce, plaintext.encode(), self._purpose)
        return f"{VERSION}.{base64.urlsafe_b64encode(nonce + sealed).decode()}"

    def decrypt(self, token: str) -> str:
        version, _, payload = token.partition(".")
        if version != VERSION:
            raise DecryptionError("Unknown format")
        try:
            raw = base64.urlsafe_b64decode(payload)
            return self._aead.decrypt(raw[:12], raw[12:], self._purpose).decode()
        except (InvalidTag, ValueError, binascii.Error) as error:
            raise DecryptionError("Can't decrypt this value") from error
