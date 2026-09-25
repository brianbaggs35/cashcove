#!/usr/bin/env python3
"""Container healthcheck: GET /api/health through nginx on the TLS port."""

import json
import ssl
import sys
import urllib.request

# The certificate may be self-signed or issued for another name; this only checks liveness.
context = ssl.create_default_context()
context.check_hostname = False
context.verify_mode = ssl.CERT_NONE

try:
    # nginx refuses TLS connections that don't name a site it serves, and "localhost" is one.
    # The URL is a fixed https loopback address, so B310's file:// concern doesn't apply.
    with urllib.request.urlopen(  # nosec B310
        "https://localhost:8443/api/health", timeout=4, context=context
    ) as response:
        sys.exit(0 if json.load(response).get("status") == "ok" else 1)
except Exception as error:
    print(f"unhealthy: {error}", file=sys.stderr)
    sys.exit(1)
