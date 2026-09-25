# syntax=docker/dockerfile:1

# Cashcove ships as one container: nginx (TLS), the FastAPI app, Postgres and the built
# Vue frontend, run by supervisord. Build stages keep Node, uv and compilers out of the
# final image.

ARG PYTHON_VERSION=3.14
ARG NODE_VERSION=24
ARG POSTGRES_VERSION=18
ARG UV_VERSION=0.12.19
ARG SUPERVISOR_VERSION=4.3.0

# ---- Frontend: type-check and build static assets ------------------------------------
FROM node:${NODE_VERSION}-trixie-slim AS frontend-build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- uv binary ------------------------------------------------------------------------
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ---- Backend: resolve the locked Python environment -----------------------------------
FROM python:${PYTHON_VERSION}-slim-trixie AS backend-build
ARG SUPERVISOR_VERSION
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
# supervisord gets its own environment so it never shares dependencies with the app.
RUN python -m venv /opt/supervisor \
    && /opt/supervisor/bin/pip install --no-cache-dir "supervisor==${SUPERVISOR_VERSION}"

# ---- Runtime base: Postgres from PGDG and nginx mainline from nginx.org ----------------
FROM python:${PYTHON_VERSION}-slim-trixie AS runtime-base
ARG POSTGRES_VERSION
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl openssl; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list; \
    curl -fsSL -o /usr/share/keyrings/nginx-archive-keyring.asc https://nginx.org/keys/nginx_signing.key; \
    echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.asc] https://nginx.org/packages/mainline/debian trixie nginx" \
        > /etc/apt/sources.list.d/nginx.list; \
    printf 'Package: *\nPin: origin nginx.org\nPin-Priority: 900\n' > /etc/apt/preferences.d/99nginx; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-common; \
    sed -ri 's/#?\s*create_main_cluster.*/create_main_cluster = false/' /etc/postgresql-common/createcluster.conf; \
    apt-get install -y --no-install-recommends "postgresql-${POSTGRES_VERSION}" nginx; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/* /etc/nginx/conf.d/default.conf; \
    groupadd --system --gid 10001 cashcove; \
    useradd --system --uid 10001 --gid cashcove --home-dir /app --shell /usr/sbin/nologin cashcove
ENV PATH=/opt/venv/bin:/opt/supervisor/bin:/usr/lib/postgresql/${POSTGRES_VERSION}/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CASHCOVE_POSTGRES_VERSION=${POSTGRES_VERSION}
COPY --from=backend-build /opt/venv /opt/venv
COPY --from=backend-build /opt/supervisor /opt/supervisor
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/templates /etc/nginx/cashcove-templates
COPY docker/supervisor/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/supervisor/conf.d /etc/supervisor/conf.d
COPY --chmod=0755 docker/entrypoint.sh docker/start-api.sh docker/render-template.py \
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
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
COPY --from=frontend-build /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=uv /uv /usr/local/bin/uv
RUN set -eux; \
    ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
    CASHCOVE_MODE=development CASHCOVE_ENVIRONMENT=development
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen
WORKDIR /app/frontend
COPY --chown=cashcove:cashcove frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund && chown -R cashcove:cashcove /app/frontend
WORKDIR /app
COPY docker/supervisor/dev.d /etc/supervisor/conf.d

# ---- Production image (default target) ------------------------------------------------
FROM runtime-base AS runtime
COPY --from=frontend-build /src/dist /usr/share/cashcove/www
ENV CASHCOVE_MODE=production CASHCOVE_ENVIRONMENT=production
