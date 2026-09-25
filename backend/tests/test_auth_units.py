"""Unit tests for the building blocks behind sign-in."""

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pyotp
import pytest
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.auth import passkeys, throttle, totp
from app.auth.crypto import DecryptionError, SecretBox
from app.auth.passwords import MAX_LENGTH, Passwords, password_problem
from app.auth.tokens import CODE_ALPHABET, hash_code, new_code, normalize_code, tokens_match
from app.auth.useragent import describe
from app.config import Settings
from app.models import LoginThrottle
from app.models.base import UTCDateTime

KEY = b"k" * 32


def test_codes_are_easy_to_read_and_type() -> None:
    code = new_code(3)
    groups = code.split("-")
    assert [len(group) for group in groups] == [4, 4, 4]
    assert set("".join(groups)) <= set(CODE_ALPHABET)
    assert normalize_code(f" {code.upper().replace('-', ' ')} ") == code.replace("-", "")
    assert hash_code(code.upper()) == hash_code(code)


def test_tokens_are_compared_in_constant_time() -> None:
    assert tokens_match("abc", "abc")
    assert not tokens_match("abc", "abd")


def test_secret_box_round_trip() -> None:
    box = SecretBox(KEY, purpose="totp")
    sealed = box.encrypt("JBSWY3DPEHPK3PXP")
    assert sealed.startswith("v1.")
    assert "JBSWY3DPEHPK3PXP" not in sealed
    assert box.decrypt(sealed) == "JBSWY3DPEHPK3PXP"
    # Every encryption uses a fresh nonce.
    assert box.encrypt("JBSWY3DPEHPK3PXP") != sealed


@pytest.mark.parametrize("change", ["version", "ciphertext", "garbage", "empty"])
def test_secret_box_refuses_tampered_values(change: str) -> None:
    box = SecretBox(KEY, purpose="totp")
    sealed = box.encrypt("secret")
    tampered = {
        "version": "v2" + sealed[2:],
        "ciphertext": sealed[:-4] + "AAAA",
        "garbage": "v1.not base64!",
        "empty": "v1.",
    }[change]
    with pytest.raises(DecryptionError):
        box.decrypt(tampered)


def test_secret_box_keys_are_separate_per_purpose() -> None:
    sealed = SecretBox(KEY, purpose="totp").encrypt("secret")
    with pytest.raises(DecryptionError):
        SecretBox(KEY, purpose="other").decrypt(sealed)
    with pytest.raises(DecryptionError):
        SecretBox(b"x" * 32, purpose="totp").decrypt(sealed)


@pytest.mark.parametrize(
    ("password", "problem"),
    [
        ("short", "Use at least 12 characters."),
        ("x" * (MAX_LENGTH + 1), f"Use at most {MAX_LENGTH} characters."),
        ("Password1234", "This password is too common. Choose something less predictable."),
        ("abababababab", "Use more than a few different characters."),
        ("alexcashcove1", "Too much of this password is your name, email address or Cashcove."),
        ("rivera-alex-99", "Too much of this password is your name, email address or Cashcove."),
    ],
)
def test_weak_passwords_are_explained(password: str, problem: str) -> None:
    assert password_problem(password, email="alex@example.com", name="Alex J Rivera") == problem


def test_good_passwords_pass() -> None:
    # Short name parts like "J" aren't treated as part of the password.
    assert password_problem("jelly-mountain-cab", email="al@example.com", name="Al J") is None


def test_passwords_are_normalised_before_hashing() -> None:
    hasher = Passwords(time_cost=1, memory_kib=8, parallelism=1)
    # A fullwidth "A" (U+FF21) and a plain "A" are the same once NFKC-normalised.
    stored = hasher.hash("\uff21pricot-orchard-9")
    assert hasher.verify("Apricot-orchard-9", stored) == (True, None)
    assert hasher.verify("apricot-orchard-9", stored)[0] is False
    assert hasher.verify("anything", None) == (False, None)


def test_totp_codes_allow_a_little_clock_drift() -> None:
    secret = totp.new_secret()
    now = datetime(2026, 9, 25, 12, 0, 15, tzinfo=UTC)
    step = int(now.timestamp()) // 30
    code_for = pyotp.TOTP(secret).at
    assert totp.matching_step(secret, code_for(now), at=now) == step
    assert totp.matching_step(secret, code_for(now - timedelta(seconds=30)), at=now) == step - 1
    assert totp.matching_step(secret, code_for(now + timedelta(seconds=30)), at=now) == step + 1
    assert totp.matching_step(secret, code_for(now + timedelta(seconds=60)), at=now) is None
    # Spaces are ignored; anything that isn't six digits is refused outright.
    spaced = code_for(now)[:3] + " " + code_for(now)[3:]
    assert totp.matching_step(secret, spaced, at=now) == step
    assert totp.matching_step(secret, "12345", at=now) is None
    assert totp.matching_step(secret, "12a456", at=now) is None


def test_totp_codes_cannot_be_replayed() -> None:
    secret = totp.new_secret()
    now = datetime(2026, 9, 25, 12, 0, 15, tzinfo=UTC)
    step = int(now.timestamp()) // 30
    code = pyotp.TOTP(secret).at(now)
    assert totp.matching_step(secret, code, at=now, last_step=step) is None
    assert totp.matching_step(secret, code, at=now, last_step=step - 1) == step


def test_recovery_codes() -> None:
    codes = totp.new_recovery_codes()
    assert len(codes) == len(set(codes)) == totp.RECOVERY_CODE_COUNT
    assert all(len(code) == 19 for code in codes)
    assert totp.hash_recovery_code(codes[0].upper()) == totp.hash_recovery_code(codes[0])


def test_lockouts_double_and_are_capped(session: Session) -> None:
    now = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
    name = throttle.key(throttle.EMAIL, "Alex@Example.com")
    assert name == "email:alex@example.com"
    for _ in range(throttle.EMAIL.free_attempts):
        throttle.record_failure(session, name, throttle.EMAIL, now)
    assert throttle.seconds_locked(session, [name], now) == 0
    throttle.record_failure(session, name, throttle.EMAIL, now)
    assert throttle.seconds_locked(session, [name], now) == 31
    throttle.record_failure(session, name, throttle.EMAIL, now)
    assert throttle.seconds_locked(session, [name], now) == 61
    for _ in range(30):
        throttle.record_failure(session, name, throttle.EMAIL, now)
    assert throttle.seconds_locked(session, [name], now) == 15 * 60 + 1
    assert throttle.seconds_locked(session, [name], now + timedelta(minutes=16)) == 0


def test_lockouts_are_forgotten_after_a_quiet_hour(session: Session) -> None:
    now = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
    name = throttle.key(throttle.ADDRESS, "10.0.0.8")
    for _ in range(25):
        throttle.record_failure(session, name, throttle.ADDRESS, now)
    later = now + timedelta(hours=2)
    throttle.record_failure(session, name, throttle.ADDRESS, later)
    row = session.get(LoginThrottle, name)
    assert row is not None
    assert (row.failures, row.locked_until) == (1, None)


def test_old_counters_are_cleaned_up(session: Session) -> None:
    now = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
    throttle.record_failure(session, "email:old@example.com", throttle.EMAIL, now)
    throttle.record_failure(
        session, "email:new@example.com", throttle.EMAIL, now + timedelta(hours=2)
    )
    session.flush()
    assert session.get(LoginThrottle, "email:old@example.com") is None
    throttle.clear(session, "email:missing@example.com")


@pytest.mark.parametrize(
    ("agent", "label", "kind"),
    [
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
            "Safari on iPhone",
            "phone",
        ),
        (
            "Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
            "Chrome on iPad",
            "tablet",
        ),
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
            "Edge on Windows",
            "desktop",
        ),
        (
            "Mozilla/5.0 (Linux; Android 15; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) "
            "SamsungBrowser/28.0 Chrome/130.0.0.0 Safari/537.36",
            "Samsung Internet on Android",
            "tablet",
        ),
        (
            "Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0",
            "Opera on ChromeOS",
            "desktop",
        ),
        ("Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101", "Linux", "desktop"),
        ("MyScript/1.0", "Unknown device", "unknown"),
        (None, "Unknown device", "unknown"),
    ],
)
def test_devices_are_described_in_plain_words(agent: str | None, label: str, kind: str) -> None:
    device = describe(agent)
    assert (device.label, device.kind) == (label, kind)


def test_passkey_transports_are_filtered() -> None:
    assert passkeys.credential_transports({}) == []
    assert passkeys.credential_transports({"response": "nope"}) == []
    assert passkeys.credential_transports({"response": {"transports": "usb"}}) == []
    assert passkeys.credential_transports(
        {"response": {"transports": ["usb", 7, "nfc", "smoke-signal"]}}
    ) == ["usb", "nfc"]


def test_passkey_ids_that_do_not_decode() -> None:
    assert passkeys.credential_id({"rawId": ""}) is None
    assert passkeys.credential_id({"rawId": "a"}) is None
    assert passkeys.credential_id({}) is None
    assert passkeys.decode_challenge(None) is None


def test_settings_describe_the_public_address() -> None:
    assert Settings(server_name="cashcove.home.example").public_origin == (
        "https://cashcove.home.example"
    )
    assert Settings(server_name="cashcove.home.example", https_port=8443).public_origin == (
        "https://cashcove.home.example:8443"
    )
    assert Settings(server_name="cashcove.home.example").passkeys_supported
    assert not Settings(server_name="192.168.1.20").passkeys_supported
    assert not Settings(server_name="fd00::20").passkeys_supported


def test_the_secret_key_comes_from_the_environment_or_the_key_file(tmp_path: Path) -> None:
    key_file = tmp_path / "secret.key"
    key_file.write_text("f" * 44 + "\n", encoding="utf-8")
    assert Settings(secret_key_file=key_file).read_secret_key() == b"f" * 44
    from_env = Settings(secret_key=SecretStr("e" * 32), secret_key_file=key_file)
    assert from_env.read_secret_key() == b"e" * 32
    with pytest.raises(ValueError, match="at least 32 characters"):
        Settings(secret_key=SecretStr("too short")).read_secret_key()


def test_timestamps_are_always_utc() -> None:
    column = UTCDateTime()
    dialect = create_engine("sqlite://").dialect
    local = datetime(2026, 9, 25, 3, 0, tzinfo=timezone(timedelta(hours=-5)))
    utc = datetime(2026, 9, 25, 8, 0, tzinfo=UTC)
    assert column.process_bind_param(None, dialect) is None
    stored = column.process_bind_param(local, dialect)
    assert stored == utc
    assert stored is not None
    assert stored.tzinfo is UTC
    with pytest.raises(ValueError, match="timezone-aware"):
        column.process_bind_param(datetime(2026, 9, 25, 8, 0), dialect)
    assert column.process_result_value(None, dialect) is None
    # SQLite drops the offset, and values read back without one are UTC.
    assert column.process_result_value(datetime(2026, 9, 25, 8, 0), dialect) == utc
    loaded = column.process_result_value(local, dialect)
    assert loaded is not None
    assert loaded.tzinfo is UTC
