"""Request and response models for sign-in, accounts and user management."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
)

from app.auth.passkeys import encode_id
from app.auth.passwords import MAX_LENGTH
from app.auth.useragent import DeviceKind
from app.models import Role


def _lower(value: str) -> str:
    return value.lower()


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


Email = Annotated[EmailStr, Field(max_length=254), AfterValidator(_lower)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
# Length rules for new passwords are checked separately so the message can explain them.
Password = Annotated[str, Field(min_length=1, max_length=MAX_LENGTH)]
Token = Annotated[str, Field(min_length=1, max_length=128)]
Code = Annotated[str, Field(min_length=1, max_length=64)]
# The PublicKeyCredential JSON a browser returns; the WebAuthn library validates it.
Credential = dict[str, Any]
TwoFactorMethod = Literal["totp", "recovery_code", "passkey"]


def _encoded_id(value: object) -> object:
    return encode_id(value) if isinstance(value, bytes) else value


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str
    role: Role
    is_active: bool
    totp_enabled: bool
    passkey_count: int = 0
    recovery_codes_left: int = 0
    created_at: datetime
    last_sign_in_at: datetime | None
    # The handle this person's passkeys carry, so the browser can be told which are current.
    webauthn_user_id: Annotated[str, BeforeValidator(_encoded_id)] = Field(
        validation_alias="webauthn_id"
    )


class SessionInfo(BaseModel):
    csrf_token: str
    expires_at: datetime
    idle_timeout_seconds: int
    remember: bool


class SessionState(BaseModel):
    """What the web app needs to know on load: who's signed in, if anyone."""

    setup_required: bool
    user: UserOut | None = None
    session: SessionInfo | None = None
    # Passkeys and the check that requests come from Cashcove are bound to this address.
    origin: str
    passkeys_supported: bool


class SetupCodeRequest(_Strict):
    setup_code: Code


class SetupRequest(SetupCodeRequest):
    name: Name
    email: Email
    password: Password


class SignInRequest(_Strict):
    # Not validated as an address, so a typo gets the same answer as a wrong password.
    email: Annotated[str, Field(min_length=1, max_length=254)]
    password: Password
    remember: bool = False


class SignInResult(BaseModel):
    status: Literal["signed_in", "two_factor_required"]
    state: SessionState | None = None
    methods: list[TwoFactorMethod] = []


class CodeRequest(_Strict):
    code: Code


class PasswordRequest(_Strict):
    password: Password


class PasskeyOptions(BaseModel):
    challenge_id: str
    options: dict[str, Any]


class PasskeyAnswer(_Strict):
    challenge_id: Token
    credential: Credential


class PasskeySignInRequest(PasskeyAnswer):
    remember: bool = False


class PasswordChangeRequest(_Strict):
    current_password: Password
    new_password: Password


class TokenRequest(_Strict):
    token: Token


class InvitationPreview(BaseModel):
    household_name: str
    name: str
    email: str
    role: Role
    invited_by: str | None
    expires_at: datetime


class AcceptInvitationRequest(_Strict):
    token: Token
    name: Name
    password: Password


class PasswordResetPreview(BaseModel):
    name: str
    email: str
    expires_at: datetime


class CompletePasswordResetRequest(_Strict):
    token: Token
    password: Password


class ProfileUpdate(_Strict):
    name: Name
    email: Email


class TotpSetup(BaseModel):
    """A new authenticator key, shown as a QR code and as text for manual entry."""

    secret: str
    uri: str
    expires_at: datetime


class RecoveryCodes(BaseModel):
    codes: list[str]


class PasskeyOut(BaseModel):
    id: uuid.UUID
    credential_id: str
    name: str
    provider: str | None
    backed_up: bool
    created_at: datetime
    last_used_at: datetime | None


class PasskeyRegistration(PasskeyAnswer):
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""


class PasskeyRename(_Strict):
    name: Name


class SessionOut(BaseModel):
    id: uuid.UUID
    device: str
    browser: str | None
    system: str | None
    kind: DeviceKind
    ip_address: str | None
    remember: bool
    current: bool
    created_at: datetime
    last_seen_at: datetime


class SessionsEnded(BaseModel):
    ended: int


class ActivityOut(BaseModel):
    id: uuid.UUID
    event: str
    created_at: datetime
    user_name: str | None
    actor_name: str | None
    ip_address: str | None
    device: str | None
    details: dict[str, Any]


class MemberDetails(BaseModel):
    """How someone signs in. Only admins see this about other people."""

    totp_enabled: bool
    passkey_count: int
    last_sign_in_at: datetime | None


class MemberOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: Role
    is_active: bool
    created_at: datetime
    details: MemberDetails | None = None


class InvitationCreate(_Strict):
    email: Email
    name: Name
    role: Role


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: Role
    invited_by: str | None
    created_at: datetime
    expires_at: datetime


class InvitationLink(BaseModel):
    """The link is shown once: only a hash of its token is stored."""

    invitation: InvitationOut
    link: str


class UserUpdate(_Strict):
    role: Role | None = None
    is_active: bool | None = None


class ResetLink(BaseModel):
    link: str
    expires_at: datetime
