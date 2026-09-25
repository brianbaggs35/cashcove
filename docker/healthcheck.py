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
    with urllib.request.urlopen(  # noqa: S310 - fixed loopback URL
        "https://127.0.0.1:8443/api/health", timeout=4, context=context
    ) as response:
        sys.exit(0 if json.load(response).get("status") == "ok" else 1)
except Exception as error:  # noqa: BLE001 - any failure means unhealthy
    print(f"unhealthy: {error}", file=sys.stderr)
    sys.exit(1)
