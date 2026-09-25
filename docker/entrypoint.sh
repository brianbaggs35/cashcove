#!/bin/sh
# Prepares the data volume, database, app secret, TLS certificate and nginx config, then
# hands the container to supervisord. Runs as root; every long-running process drops
# privileges.
set -eu

DATA_DIR=/data
PGDATA="$DATA_DIR/postgres"
SECRETS_DIR="$DATA_DIR/secrets"
TLS_DIR=/run/cashcove/tls
: "${CASHCOVE_MODE:=production}"
: "${CASHCOVE_SERVER_NAME:=localhost}"
: "${CASHCOVE_HTTPS_PORT:=443}"
: "${CASHCOVE_PLAID_ENV:=sandbox}"
export CASHCOVE_MODE CASHCOVE_SERVER_NAME CASHCOVE_HTTPS_PORT CASHCOVE_PLAID_ENV

log() { echo "cashcove: $*"; }

# Runs a command as a service account, without a login shell or PAM.
as_user() {
    user="$1"
    shift
    setpriv --reuid="$user" --regid="$user" --init-groups "$@"
}

umask 022
mkdir -p "$PGDATA" "$SECRETS_DIR" "$DATA_DIR/certs" /run/postgresql /run/nginx /run/cashcove \
    "$TLS_DIR" /var/cache/nginx /etc/nginx/cashcove /etc/nginx/conf.d

# ---- Postgres ----------------------------------------------------------------------
# A volume created by an older image can hold the database under a different user ID.
pg_owner="$(stat -c %u "$PGDATA")"
[ -e "$PGDATA/PG_VERSION" ] && pg_owner="$(stat -c %u "$PGDATA/PG_VERSION")"
if [ "$pg_owner" != "$(id -u postgres)" ]; then
    log "handing the database files to the postgres user"
    chown -R postgres:postgres "$PGDATA"
fi
chown postgres:postgres "$PGDATA" /run/postgresql
chmod 0700 "$PGDATA"
chmod 2775 /run/postgresql
chown nginx:nginx /run/nginx /var/cache/nginx

# The database listens only on a unix socket and trusts the OS user via peer auth, so no
# password exists to leak and nothing outside the container can connect. The builtin
# C.UTF-8 collation doesn't depend on the operating system's locale data.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
    log "initialising database"
    as_user postgres initdb -D "$PGDATA" --encoding=UTF8 --locale=C \
        --locale-provider=builtin --builtin-locale=C.UTF-8 \
        --auth-local=peer --auth-host=reject >/dev/null
    cat >>"$PGDATA/postgresql.conf" <<CONF

# Cashcove
listen_addresses = ''
unix_socket_directories = '/run/postgresql'
password_encryption = 'scram-sha-256'
log_destination = 'stderr'
log_min_messages = warning
CONF
    as_user postgres pg_ctl -D "$PGDATA" -w -o "-c listen_addresses=''" start >/dev/null
    as_user postgres psql -X -v ON_ERROR_STOP=1 -q -h /run/postgresql -d postgres <<SQL
CREATE ROLE cashcove LOGIN;
CREATE DATABASE cashcove OWNER cashcove;
REVOKE ALL ON DATABASE cashcove FROM PUBLIC;
SQL
    as_user postgres pg_ctl -D "$PGDATA" -w -m fast stop >/dev/null
fi

# ---- App secret --------------------------------------------------------------------
# Encrypts sensitive values, such as authenticator-app keys, before they reach the
# database, so a database dump on its own doesn't reveal them. Only the API can read it.
if [ ! -s "$SECRETS_DIR/secret.key" ]; then
    log "generating the app secret key"
    (umask 077 && openssl rand -base64 32 >"$SECRETS_DIR/secret.key")
fi
chown -R cashcove:cashcove "$SECRETS_DIR"
chmod 0700 "$SECRETS_DIR"
chmod 0400 "$SECRETS_DIR/secret.key"

# ---- TLS -----------------------------------------------------------------------------
# Use your own certificate from /certs (e.g. from Let's Encrypt via DNS challenge) when
# present; otherwise generate a self-signed one for CASHCOVE_SERVER_NAME.
if [ -s /certs/fullchain.pem ] && [ -s /certs/privkey.pem ]; then
    log "using certificate from /certs"
    cp /certs/fullchain.pem "$TLS_DIR/cert.pem"
    cp /certs/privkey.pem "$TLS_DIR/key.pem"
else
    SELF_SIGNED="$DATA_DIR/certs/selfsigned"
    if [ ! -s "$SELF_SIGNED.crt" ] || [ "$(cat "$SELF_SIGNED.name" 2>/dev/null)" != "$CASHCOVE_SERVER_NAME" ]; then
        log "generating a self-signed certificate for $CASHCOVE_SERVER_NAME"
        (umask 077 && openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -noenc -days 825 \
            -subj "/CN=$CASHCOVE_SERVER_NAME" \
            -addext "subjectAltName=DNS:$CASHCOVE_SERVER_NAME,DNS:localhost,IP:127.0.0.1" \
            -keyout "$SELF_SIGNED.key" -out "$SELF_SIGNED.crt" 2>/dev/null)
        echo "$CASHCOVE_SERVER_NAME" >"$SELF_SIGNED.name"
    fi
    cp "$SELF_SIGNED.crt" "$TLS_DIR/cert.pem"
    cp "$SELF_SIGNED.key" "$TLS_DIR/key.pem"
fi
chown root:nginx "$TLS_DIR" "$TLS_DIR/cert.pem" "$TLS_DIR/key.pem"
chmod 0750 "$TLS_DIR"
chmod 0640 "$TLS_DIR/cert.pem" "$TLS_DIR/key.pem"
export CASHCOVE_TLS_CERT="$TLS_DIR/cert.pem" CASHCOVE_TLS_KEY="$TLS_DIR/key.pem"

# ---- nginx -----------------------------------------------------------------------------
case "$CASHCOVE_PLAID_ENV" in
    production) PLAID_API=https://production.plaid.com ;;
    *) PLAID_API=https://sandbox.plaid.com ;;
esac
CONNECT_EXTRA=""
[ "$CASHCOVE_MODE" = development ] && CONNECT_EXTRA=" wss:"

# Everything is same-origin except Plaid Link, which must load from cdn.plaid.com
# (https://plaid.com/docs/link/web/). Vuetify and Plaid both inject styles at runtime.
# The single quotes are part of the CSP syntax, not shell quoting.
# shellcheck disable=SC2089,SC2090
export CASHCOVE_CSP="default-src 'self'; script-src 'self' https://cdn.plaid.com/link/v2/stable/link-initialize.js; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.plaid.com; font-src 'self' data:; connect-src 'self' $PLAID_API$CONNECT_EXTRA; frame-src https://cdn.plaid.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"
if [ "$CASHCOVE_HTTPS_PORT" = 443 ]; then CASHCOVE_HTTPS_PORT_SUFFIX=""; else CASHCOVE_HTTPS_PORT_SUFFIX=":$CASHCOVE_HTTPS_PORT"; fi
# nginx also answers to localhost, which the container's own healthcheck connects to.
CASHCOVE_SERVER_NAMES="$CASHCOVE_SERVER_NAME"
[ "$CASHCOVE_SERVER_NAME" = localhost ] || CASHCOVE_SERVER_NAMES="$CASHCOVE_SERVER_NAME localhost"
export CASHCOVE_HTTPS_PORT_SUFFIX CASHCOVE_SERVER_NAMES

TEMPLATES=/etc/nginx/cashcove-templates
python3 /app/docker/render-template.py "$TEMPLATES/cashcove.conf" /etc/nginx/conf.d/cashcove.conf
python3 /app/docker/render-template.py "$TEMPLATES/security-headers.conf" /etc/nginx/cashcove/security-headers.conf
cp "$TEMPLATES/api-proxy.conf" /etc/nginx/cashcove/api-proxy.conf
cp "$TEMPLATES/app-$CASHCOVE_MODE.conf" /etc/nginx/cashcove/app.conf
nginx -e stderr -t -q

log "starting ($CASHCOVE_MODE mode, https://$CASHCOVE_SERVER_NAME$CASHCOVE_HTTPS_PORT_SUFFIX)"
exec supervisord -c /etc/supervisor/supervisord.conf
