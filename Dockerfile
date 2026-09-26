# syntax=docker/dockerfile:1

# Cashcove ships as one container: nginx (TLS), the FastAPI app, Postgres and the built
# Vue frontend, run by supervisord. Every stage builds on Chainguard's Wolfi, whose
# packages are rebuilt as soon as CVE fixes land, and the build stages keep Node, uv and
# compilers out of the final image.

# Chainguard's free tier only publishes wolfi-base as :latest, so it's pinned by digest to
# keep builds reproducible; `apk upgrade` below still pulls the newest package fixes.
ARG WOLFI_BASE=cgr.dev/chainguard/wolfi-base:latest@sha256:fac38d12efdb4bf43ac9e599a31db10a27ad5dd71e5f1618790962eda8d66180
ARG PYTHON_VERSION=3.14
ARG NODE_VERSION=24
ARG POSTGRES_VERSION=18
ARG UV_VERSION=0.12.19
ARG SUPERVISOR_VERSION=4.3.0

# ---- Wolfi base, upgraded to the latest packages ----------------------------------------
FROM ${WOLFI_BASE} AS wolfi
# CI passes the date here so cached layers are refreshed at least daily.
ARG APK_REFRESH=""
RUN echo "apk refresh: ${APK_REFRESH:-none}" && apk upgrade --no-cache

# ---- Frontend: type-check and build static assets ------------------------------------
# The web app is the same on every CPU, so a multi-platform release builds it once, natively
# on the build machine, instead of under emulation for each platform.
FROM --platform=$BUILDPLATFORM ${WOLFI_BASE} AS frontend-build
ARG NODE_VERSION
ARG APK_REFRESH=""
RUN echo "apk refresh: ${APK_REFRESH:-none}" && apk upgrade --no-cache \
    && apk add --no-cache "nodejs-${NODE_VERSION}" npm
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
# No package's install scripts run (none of these need one), and the Python stages below
# install prebuilt wheels only, so installing dependencies never runs their code.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- uv binary ------------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ---- Backend: resolve the locked Python environment -----------------------------------
FROM wolfi AS backend-build
ARG PYTHON_VERSION
ARG SUPERVISOR_VERSION
RUN apk add --no-cache "python-${PYTHON_VERSION}"
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON=/usr/bin/python${PYTHON_VERSION} \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-build
# supervisord gets its own environment so it never shares dependencies with the app.
RUN uv venv /opt/supervisor \
    && uv pip install --no-build --python /opt/supervisor/bin/python \
        "supervisor==${SUPERVISOR_VERSION}"

# ---- Runtime base: Postgres, nginx mainline and Python from Wolfi ----------------------
FROM wolfi AS runtime-base
ARG PYTHON_VERSION
ARG POSTGRES_VERSION
# Wolfi packages don't create service accounts, so they're made here with fixed IDs that
# stay the same across rebuilds (the database files on the volume belong to postgres).
RUN set -eux; \
    addgroup -S -g 10001 cashcove; \
    adduser -S -D -H -u 10001 -G cashcove -h /app -s /sbin/nologin cashcove; \
    addgroup -S -g 10002 postgres; \
    adduser -S -D -H -u 10002 -G postgres -h /var/lib/postgresql -s /sbin/nologin postgres; \
    addgroup -S -g 10003 nginx; \
    adduser -S -D -H -u 10003 -G nginx -h /var/lib/nginx -s /sbin/nologin nginx; \
    apk add --no-cache ca-certificates-bundle tzdata openssl setpriv \
        "python-${PYTHON_VERSION}" \
        "postgresql-${POSTGRES_VERSION}" "postgresql-${POSTGRES_VERSION}-client" \
        nginx-mainline nginx-mainline-config; \
    rm -f /etc/nginx/conf.d/default.conf
ENV PATH=/opt/venv/bin:/opt/supervisor/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY --from=backend-build /opt/venv /opt/venv
COPY --from=backend-build /opt/supervisor /opt/supervisor
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/templates /etc/nginx/cashcove-templates
COPY docker/supervisor/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/supervisor/conf.d /etc/supervisor/conf.d
COPY --chmod=0755 docker/entrypoint.sh docker/start-api.sh docker/render-nginx-config.py \
    docker/healthcheck.py docker/exit-on-fatal.py /app/docker/
COPY backend/alembic.ini /app/backend/alembic.ini
COPY backend/migrations /app/backend/migrations
COPY backend/app /app/backend/app
VOLUME ["/data"]
EXPOSE 8080 8443
# Checks the whole path (nginx, TLS, API, database), not just the API process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "/app/docker/healthcheck.py"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]

# ---- Development: same container plus Node, dev tools and live reload ------------------
FROM runtime-base AS dev
ARG NODE_VERSION
ARG PYTHON_VERSION
RUN apk add --no-cache "nodejs-${NODE_VERSION}" npm
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON=/usr/bin/python${PYTHON_VERSION} \
    UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
    CASHCOVE_MODE=development CASHCOVE_ENVIRONMENT=development
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-build
WORKDIR /app/frontend
COPY --chown=cashcove:cashcove frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && chown -R cashcove:cashcove /app/frontend
WORKDIR /app
COPY docker/supervisor/dev.d /etc/supervisor/conf.d

# ---- End-to-end test image: `make e2e` -------------------------------------------------
# The production image plus what the Playwright tests need: the test harness (backend/e2e),
# which resets the database and signs browsers in, coverage.py around the API, source maps
# in the web app, and nginx's per-address rate limits lifted, since tests sign in far faster
# than people do. The harness can erase everything, so this image is never deployed.
FROM frontend-build AS frontend-e2e-build
RUN npm run build:e2e

FROM backend-build AS backend-e2e-build
RUN uv sync --frozen --no-dev --no-build --group e2e

FROM runtime-base AS e2e
COPY --from=backend-e2e-build /opt/venv /opt/venv
COPY --from=frontend-e2e-build /src/dist /usr/share/cashcove/www
COPY backend/e2e /app/backend/e2e
COPY docker/e2e/coveragerc /app/docker/e2e/coveragerc
COPY --chmod=0755 docker/e2e/start-api.sh /app/docker/e2e/start-api.sh
COPY docker/e2e/api.conf /etc/supervisor/conf.d/api.conf
RUN sed -i -e 's|zone=api:10m rate=20r/s;|zone=api:10m rate=500r/s;|' \
        -e 's|zone=auth:10m rate=10r/m;|zone=auth:10m rate=500r/s;|' /etc/nginx/nginx.conf \
    && grep -q 'zone=api:10m rate=500r/s;' /etc/nginx/nginx.conf \
    && grep -q 'zone=auth:10m rate=500r/s;' /etc/nginx/nginx.conf
ENV CASHCOVE_MODE=production CASHCOVE_ENVIRONMENT=test

# ---- Production image (default target) ------------------------------------------------
FROM runtime-base AS runtime
# The release workflow passes the release's version (e.g. 1.4.0), which Settings > System
# shows; other builds report the version in backend/app/__init__.py.
ARG RELEASE=""
COPY --from=frontend-build /src/dist /usr/share/cashcove/www
ENV CASHCOVE_MODE=production CASHCOVE_ENVIRONMENT=production CASHCOVE_RELEASE=${RELEASE}
