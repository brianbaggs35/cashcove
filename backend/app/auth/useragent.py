"""Turns a User-Agent header into something a person recognises, like "Safari on iPhone"."""

import re
from dataclasses import dataclass
from typing import Literal

DeviceKind = Literal["desktop", "phone", "tablet", "unknown"]

# Order matters: Edge and Opera also claim to be Chrome, and Chrome claims to be Safari.
_BROWSERS: list[tuple[str, str]] = [
    (r"Edg(e|A|iOS)?/", "Edge"),
    (r"OPR/|Opera", "Opera"),
    (r"SamsungBrowser/", "Samsung Internet"),
    (r"Firefox/|FxiOS/", "Firefox"),
    (r"Chrome/|CriOS/", "Chrome"),
    (r"Safari/", "Safari"),
]

_SYSTEMS: list[tuple[str, str, DeviceKind]] = [
    (r"iPhone", "iPhone", "phone"),
    (r"iPad", "iPad", "tablet"),
    (r"Android.*Mobile", "Android", "phone"),
    (r"Android", "Android", "tablet"),
    (r"CrOS", "ChromeOS", "desktop"),
    (r"Windows", "Windows", "desktop"),
    (r"Macintosh|Mac OS X", "macOS", "desktop"),
    (r"Linux", "Linux", "desktop"),
]


@dataclass(frozen=True)
class Device:
    browser: str | None
    system: str | None
    kind: DeviceKind

    @property
    def label(self) -> str:
        if self.browser and self.system:
            return f"{self.browser} on {self.system}"
        return self.browser or self.system or "Unknown device"


def _system(agent: str) -> tuple[str | None, DeviceKind]:
    for pattern, name, kind in _SYSTEMS:
        if re.search(pattern, agent):
            return name, kind
    return None, "unknown"


def describe(user_agent: str | None) -> Device:
    agent = user_agent or ""
    browser = next((name for pattern, name in _BROWSERS if re.search(pattern, agent)), None)
    system, kind = _system(agent)
    return Device(browser=browser, system=system, kind=kind)
