#!/usr/bin/env bash
# Smoke test for a running Cashcove container: TLS, the API and database, the web app,
# the HTTP redirect and the security headers. The certificate is self-signed in CI.
set -euo pipefail

https_port="${CASHCOVE_HTTPS_PORT:-443}"
http_port="${CASHCOVE_HTTP_PORT:-80}"
base="https://localhost:${https_port}"

fail() {
    echo "::error::$1" >&2
    exit 1
}

echo "API health"
health="$(curl --silent --show-error --fail --insecure "$base/api/health")"
echo "$health"
jq --exit-status '.status == "ok" and .database == "ok"' <<<"$health" >/dev/null ||
    fail "API health is not ok"

echo "System info"
curl --silent --show-error --fail --insecure "$base/api/system" | jq --exit-status '.version' >/dev/null ||
    fail "/api/system did not return a version"

echo "Web app"
index="$(curl --silent --show-error --fail --insecure "$base/")"
grep --quiet '<div id="app">' <<<"$index" || fail "the web app's index page did not load"

echo "HTTP redirects to HTTPS"
location="$(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' \
    "http://localhost:${http_port}/settings" || true)"
[ "$location" = "301 ${base}/settings" ] || fail "expected '301 ${base}/settings', got '$location'"

echo "Security headers"
headers="$(curl --silent --show-error --fail --insecure --dump-header - --output /dev/null "$base/")"
for header in strict-transport-security content-security-policy x-content-type-options \
    x-frame-options referrer-policy permissions-policy cross-origin-opener-policy; do
    grep --quiet --ignore-case "^${header}:" <<<"$headers" || fail "missing the $header header"
done
csp="$(grep --ignore-case '^content-security-policy:' <<<"$headers")"
for source in "https://cdn.plaid.com/link/v2/stable/link-initialize.js" "frame-src https://cdn.plaid.com" \
    "frame-ancestors 'none'"; do
    grep --quiet --fixed-strings "$source" <<<"$csp" || fail "the CSP is missing \"$source\""
done
if grep --quiet --ignore-case '^server:.*[0-9]' <<<"$headers"; then
    fail "the Server header reveals a version"
fi

echo "Smoke test passed"
