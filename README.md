# Cashcove

Self-hosted personal finance and budgeting, powered by Plaid.

Cashcove runs as **one container**: nginx (HTTPS), the Python API, PostgreSQL and the Vue
web app, managed by supervisord. One `make up` brings the whole thing online.

| Layer    | Stack                                                                 |
| -------- | --------------------------------------------------------------------- |
| Web app  | Vue 3.5, Vuetify 4, TypeScript 6, Vite 8, Pinia, Vue Router, Lucide    |
| API      | Python 3.14, FastAPI, SQLAlchemy 2.1, Alembic, Pydantic 2             |
| Database | PostgreSQL 18, on a unix socket only, peer auth, no password to leak  |
| Edge     | nginx mainline, TLS 1.2+, HSTS, strict CSP (allows Plaid Link only)   |
| Quality  | pytest, vitest (100% coverage), ruff, pyright, mypy, bandit, ESLint   |

## Quick start

```sh
cp .env.example .env      # set CASHCOVE_SERVER_NAME and your Plaid keys
make up                   # build and start
```

Then open `https://<CASHCOVE_SERVER_NAME>`. Run `make` to see every command.

### Using your own domain

1. Point a DNS record (for example `cashcove.example.com`) at the private IP of the machine
   running Cashcove, and set `CASHCOVE_SERVER_NAME` to it in `.env`.
2. Get a certificate for that name. For a private IP, use a DNS challenge (for example
   `certbot certonly --preferred-challenges dns`), since Let's Encrypt can't reach you over HTTP.
3. Copy `fullchain.pem` and `privkey.pem` into `./certs/` and run `make restart`.

Without a certificate in `./certs`, Cashcove generates a self-signed one for
`CASHCOVE_SERVER_NAME`, and your browser will ask you to trust it.

### Plaid

Add `CASHCOVE_PLAID_CLIENT_ID`, `CASHCOVE_PLAID_SECRET` and `CASHCOVE_PLAID_ENV`
(`sandbox` or `production`) to `.env`. The keys stay on the server; the browser only
loads Plaid Link from `cdn.plaid.com`, which the Content Security Policy allows along
with the matching Plaid API host.

A self-hosted install on a private network can't receive Plaid webhooks, so Cashcove
fetches new transactions on a schedule you choose in **Settings > Sync**.

## Development

```sh
make dev      # the same single container, with Vite hot reload and API auto-reload
make install  # or install dependencies locally to run tests and linters outside Docker
make test     # pytest + vitest, both must stay at 100% coverage
make lint     # ruff, pyright, mypy, bandit, ESLint, Prettier, vue-tsc, hadolint, ShellCheck, actionlint
make audit    # pip-audit and npm audit
```

Every pull request runs the same checks in GitHub Actions (`.github/workflows/ci.yml`):
the **Backend** and **Frontend** jobs run the linters, type checkers, dependency audits and
tests with 100% coverage, and the **Container** job builds the image, starts it with
`docker compose` and smoke-tests TLS, the API, the redirect and the security headers.

`make dev` mounts `backend/app`, `backend/migrations` and `frontend/` into the container,
so edits reload instantly at `https://localhost`. API docs are at `/api/docs` in dev.

### Layout

```
backend/     FastAPI app (app/), Alembic migrations, pytest suite
frontend/    Vue + Vuetify app (src/), vitest suite
docker/      entrypoint, nginx templates, supervisord programs, healthcheck
.github/     CI workflow and the container smoke test
Dockerfile   frontend build, backend build, runtime and dev stages
```

### Database migrations

```sh
cd backend
uv run alembic revision --autogenerate -m "describe the change"
```

Migrations run automatically every time the container starts.

## Operations

- `make backup` writes a `pg_dump` to `./backups/`.
- `make logs`, `make ps`, `make shell` and `make psql` help when something looks wrong.
- Data lives in the `cashcove-data` Docker volume and survives `make down` and rebuilds.
