#!/usr/bin/env python3
"""Fill ${CASHCOVE_*} placeholders in a template from the environment.

Only CASHCOVE_ names are replaced, so nginx's own $variables pass through untouched,
and a missing variable is an error rather than an empty string.
"""

import os
import re
import sys

PLACEHOLDER = re.compile(r"\$\{(CASHCOVE_[A-Z0-9_]+)\}")


def render(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in os.environ:
            sys.exit(f"render-template: {name} is not set")
        return os.environ[name]

    return PLACEHOLDER.sub(replace, text)


if __name__ == "__main__":
    source, destination = sys.argv[1:3]
    with open(source, encoding="utf-8") as template:
        rendered = render(template.read())
    with open(destination, "w", encoding="utf-8") as output:
        output.write(rendered)
