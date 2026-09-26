#!/usr/bin/env python3
"""Writes nginx's config from its templates, filling ${CASHCOVE_*} placeholders from the
environment.

Only CASHCOVE_ names are replaced, so nginx's own $variables pass through untouched, and a
missing variable is an error rather than an empty string. The templates and where they go
are fixed here, so nothing passed to the script can make it read or write another file.
"""

import os
import re
import sys
from pathlib import Path

TEMPLATES = Path("/etc/nginx/cashcove-templates")
RENDERED = {
    "cashcove.conf": Path("/etc/nginx/conf.d/cashcove.conf"),
    "security-headers.conf": Path("/etc/nginx/cashcove/security-headers.conf"),
}
PLACEHOLDER = re.compile(r"\$\{(CASHCOVE_[A-Z0-9_]+)\}")


def render(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in os.environ:
            sys.exit(f"render-nginx-config: {name} is not set")
        return os.environ[name]

    return PLACEHOLDER.sub(replace, text)


if __name__ == "__main__":
    for template, destination in RENDERED.items():
        text = (TEMPLATES / template).read_text(encoding="utf-8")
        destination.write_text(render(text), encoding="utf-8")
