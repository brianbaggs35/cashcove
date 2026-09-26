#!/usr/bin/env bash
# Smoke test for a running Cashcove container: TLS, the API and database, first-run setup
# and sign-in, the web app, the HTTP redirect and the security headers. The certificate is
# self-signed in CI. Run it twice against the same data: the first run creates the admin
# with the one-time setup code, the second signs in as that admin.
set -euo pipefail

https_port="${CASHCOVE_HTTPS_PORT:-443}"
http_port="${CASHCOVE_HTTP_PORT:-80}"
base="https://localhost:${https_port}"
password="${CASHCOVE_SMOKE_PASSWORD:?set CASHCOVE_SMOKE_PASSWORD to a password for the smoke test admin}"
email="smoke-test@example.com"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
jar="$work/cookies"
origin="$base"
csrf=""

fail() {
    echo "::error::$1" >&2
    exit 1
}

# Calls the API like the web app does: same origin, session cookie and CSRF token.
api() {
    local method="$1" path="$2"
    shift 2
    local request=(--header "Origin: $origin" --header "Content-Type: application/json")
    [[ -n "$csrf" ]] && request+=(--header "X-CSRF-Token: $csrf")
    curl --silent --show-error --insecure --cookie "$jar" --cookie-jar "$jar" \
        "${request[@]}" --request "$method" "$@" "$base$path"
}

status_of() {
    api "$@" --output /dev/null --write-out '%{http_code}'
}

echo "API health"
health="$(curl --silent --show-error --fail --insecure "$base/api/health")"
echo "$health"
jq --exit-status '.status == "ok" and .database == "ok"' <<<"$health" >/dev/null ||
    fail "API health is not ok"

echo "Signed-out visitors can't read anything"
[[ "$(status_of GET /api/system)" = 401 ]] || fail "/api/system answered without a session"

echo "First-run setup, or signing in once it's done"
state="$(api GET /api/auth/session --fail)"
if jq --exit-status '.setup_required' <<<"$state" >/dev/null; then
    code="$(docker compose exec -T -u cashcove -w /app/backend cashcove \
        python -m app.cli setup-code --plain)"
    body="$(jq --null-input --arg code "$code" --arg email "$email" --arg password "$password" \
        '{setup_code: $code, name: "Smoke Test", email: $email, password: $password}')"
    state="$(api POST /api/auth/setup --fail --data "$body" --dump-header "$work/headers")"
else
    body="$(jq --null-input --arg email "$email" --arg password "$password" \
        '{email: $email, password: $password}')"
    state="$(api POST /api/auth/sign-in --fail --data "$body" --dump-header "$work/headers" |
        jq '.state')"
fi
jq --exit-status '.user.role == "admin"' <<<"$state" >/dev/null ||
    fail "setup or sign-in did not return the admin"
cookie="$(grep --ignore-case '^set-cookie: __Host-cashcove_session=' "$work/headers")" ||
    fail "no session cookie was set"
for attribute in HttpOnly Secure "SameSite=strict" "Path=/"; do
    grep --quiet --ignore-case "$attribute" <<<"$cookie" ||
        fail "the session cookie is missing $attribute"
done
csrf="$(jq --raw-output '.session.csrf_token' <<<"$state")"

echo "Signed-in requests"
system="$(api GET /api/system --fail)"
jq --exit-status '.version' <<<"$system" >/dev/null || fail "/api/system did not return a version"
# The release workflow checks the image reports the version it was built as.
if [[ -n "${CASHCOVE_SMOKE_VERSION:-}" ]]; then
    jq --exit-status --arg version "$CASHCOVE_SMOKE_VERSION" '.version == $version' <<<"$system" \
        >/dev/null || fail "the image reports version $(jq -r .version <<<"$system"), not $CASHCOVE_SMOKE_VERSION"
fi
api GET /api/settings --fail --dump-header "$work/api-headers" --output /dev/null
grep --quiet --ignore-case '^cache-control: no-store' "$work/api-headers" ||
    fail "API responses may be cached"

echo "Changes need the CSRF token and must come from Cashcove itself"
token="$csrf"
csrf=""
[[ "$(status_of POST /api/auth/sign-out)" = 403 ]] || fail "a change without the CSRF token went through"
csrf="$token"
origin="https://evil.example"
[[ "$(status_of POST /api/auth/sign-out)" = 403 ]] || fail "a change from another origin went through"
origin="$base"

echo "Signing out"
[[ "$(status_of POST /api/auth/sign-out)" = 204 ]] || fail "signing out failed"
[[ "$(status_of GET /api/system)" = 401 ]] || fail "still signed in after signing out"

echo "Web app"
index="$(curl --silent --show-error --fail --insecure "$base/")"
grep --quiet '<div id="app">' <<<"$index" || fail "the web app's index page did not load"

echo "HTTP redirects to HTTPS"
location="$(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' \
    "http://localhost:${http_port}/settings" || true)"
[[ "$location" = "301 ${base}/settings" ]] || fail "expected '301 ${base}/settings', got '$location'"

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

echo "Unknown host names are refused during the TLS handshake"
if curl --silent --insecure --output /dev/null --resolve "unknown.example:${https_port}:127.0.0.1" \
    "https://unknown.example:${https_port}/"; then
    fail "a TLS connection for an unknown host name was accepted"
fi

echo "Smoke test passed"
