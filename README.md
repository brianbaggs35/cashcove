# Cashcove

Self-hosted personal finance and budgeting, powered by Plaid.

Cashcove runs as **one container**: nginx (HTTPS), the Python API, PostgreSQL and the Vue
web app, managed by supervisord. One `make up` brings the whole thing online.

| Layer    | Stack                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Web app  | Vue 3.5, Vuetify 4, TypeScript 6, Vite 8, Pinia, Vue Router, Lucide     |
| API      | Python 3.14, FastAPI, SQLAlchemy 2.1, Alembic, Pydantic 2               |
| Sign-in  | Argon2id passwords, passkeys, authenticator codes, server-side sessions |
| Database | PostgreSQL 18, on a unix socket only, peer auth, no password to leak    |
| Edge     | nginx mainline, TLS 1.3 only, HSTS, strict CSP (allows Plaid Link only) |
| Image    | Chainguard's Wolfi base, read-only filesystem, scanned by Trivy in CI   |
| Tests    | pytest and vitest at 100% coverage, Playwright end to end, axe          |
| Quality  | SonarQube, ruff, pyright, mypy, bandit, ESLint, vue-tsc, Trivy          |

## Quick start

```sh
cp .env.example .env      # set CASHCOVE_SERVER_NAME and your Plaid keys
make up                   # build and start
make logs                 # shows the one-time setup code
```

Then open `https://<CASHCOVE_SERVER_NAME>/welcome`. Run `make` to see every command.

### First run

Until the first admin exists, anyone who can reach Cashcove could claim it, so the setup
wizard asks for a one-time code that the container prints in its logs. Enter it, create the
admin account, protect it with a passkey or an authenticator app, name your household, and
you're in. `make setup-code` prints a fresh code if the old one expired or scrolled away.

Invite everyone else from **Settings > Users**. Each invitation is a one-time link you send
however you like (Cashcove doesn't send email), and each person is either an **admin**, who
can change anything, or a **viewer**, who sees everything and changes nothing.

### Using your own domain

1. Point a DNS record (for example `cashcove.example.com`) at the private IP of the machine
   running Cashcove, and set `CASHCOVE_SERVER_NAME` to exactly that name in `.env`. Passkeys
   are tied to it, so they only work when Cashcove is opened at that address.
2. Get a certificate for that name. Let's Encrypt can't reach a private IP, so use a DNS
   challenge. With DNS at IONOS, create an API key at
   [developer.hosting.ionos.com](https://developer.hosting.ionos.com/docs/getstarted) and run
   [lego](https://go-acme.github.io/lego/), which supports IONOS directly:

   ```sh
   IONOS_API_KEY='<prefix>.<secret>' lego run --accept-tos --email you@example.com \
     --dns ionos --domains cashcove.example.com
   cp .lego/certificates/cashcove.example.com.crt certs/fullchain.pem
   cp .lego/certificates/cashcove.example.com.key certs/privkey.pem
   ```

   Any ACME client with a DNS challenge for your provider works the same way.

3. Run `make restart`. Repeat the same steps from a scheduled job to renew: `lego run`
   renews the certificate when it's close to expiring.

Without a certificate in `./certs`, Cashcove generates a self-signed one for
`CASHCOVE_SERVER_NAME`, and your browser will ask you to trust it.

### Plaid

Add `CASHCOVE_PLAID_CLIENT_ID`, `CASHCOVE_PLAID_SECRET` and `CASHCOVE_PLAID_ENV`
(`sandbox` or `production`) to `.env`. The keys stay on the server; the browser only
loads Plaid Link from `cdn.plaid.com`, which the Content Security Policy allows along
with the matching Plaid API host.

A self-hosted install on a private network can't receive Plaid webhooks, so Cashcove
fetches new transactions on a schedule you choose in **Settings > Sync**.

## Security

Cashcove holds financial data and bank connections, so it's locked down even on a home
network.

- **Passwords** are hashed with Argon2id (RFC 9106's 64 MiB profile). New ones follow NIST
  SP 800-63B: at least 12 characters, not a common password, and not built from your name,
  email or "Cashcove". Changing your password signs out your other devices.
- **Passkeys** sign you in with a fingerprint, face or screen lock, and can't be phished.
  **Authenticator apps** add a 6-digit code after the password, with 10 one-time recovery
  codes for a lost phone. Their keys are encrypted before they reach the database.
- **Sessions** live in Postgres behind an HttpOnly, Secure, SameSite=Strict cookie. Every
  change also needs a CSRF token and a request from Cashcove's own origin. You're signed
  out after an hour without activity and after 12 hours at most, or after 14 days without
  activity and 30 days at most on a device you asked to remember. Changing your password,
  passkeys or two-step settings asks you to confirm it's you first.
- **Guessing** is slowed per email address and per client address: after a few free
  attempts, each failure locks sign-in for twice as long as the last, up to 15 minutes, and
  nginx caps how often one address can try at all.
- **Roles** are checked by the API on every request, and Cashcove always keeps at least one
  active admin. **Settings > Security** shows your devices and recent activity, and admins
  see the household's in **Settings > Users**.
- **The edge** serves TLS 1.3 only, with HSTS and a Content Security Policy that lets the
  browser run Cashcove's own code and Plaid Link, nothing else. The health check reports no
  version.
- **The image** starts from Chainguard's Wolfi, upgrades every package at build time, keeps
  build tools out, and runs with a read-only filesystem, only the Linux capabilities it
  needs and no privilege escalation. CI scans
  the source, the dependencies and the image with Trivy and fails on any fixable high or
  critical finding; `make scan` runs the same scans locally.

### Locked out

Another admin can create a password reset link or turn off two-step verification for you
in **Settings > Users**. If you're the only admin, run one of these on the server:

```sh
make reset-link EMAIL=you@example.com     # prints a one-time password reset link
make turn-off-2fa EMAIL=you@example.com   # turns off authenticator codes
```

Both are recorded in the activity log.

## Development

```sh
make dev      # the same single container, with Vite hot reload and API auto-reload
make install  # or install dependencies locally to run tests and linters outside Docker
make test     # pytest + vitest, both must stay at 100% coverage
make e2e      # Playwright end-to-end tests against a test server built from the image
make lint     # ruff, pyright, mypy, bandit, ESLint, Prettier, vue-tsc, hadolint, ShellCheck, actionlint
make audit    # pip-audit and npm audit
make scan     # Trivy on the source, dependencies, Dockerfile and built image
```

Every pull request runs the same checks in GitHub Actions (`.github/workflows/ci.yml`):
the **Backend** and **Frontend** jobs run the linters, type checkers, dependency audits and
tests with 100% coverage; the **Container** job scans with Trivy, builds the image, starts
it with `docker compose` and smoke-tests TLS, the API, first-run setup, the redirect and the
security headers; the **End-to-end** job runs the Playwright tests; and the **SonarQube**
job holds the code to SonarQube's quality gate.

`make dev` mounts `backend/app`, `backend/migrations` and `frontend/` into the container,
so edits reload instantly at `https://localhost`. API docs are at `/api/docs` in dev.

### End-to-end tests

The Playwright tests start every spec from the same baseline data (a household with two
admins, a viewer, a turned-off account and a pending invitation), which a before block
resets. Fixtures sign the browser in as anyone, call the API as anyone, and collect coverage
of both the web app and the API; every page is also checked for accessibility problems.
[frontend/e2e/README.md](frontend/e2e/README.md) covers running them, the baseline and
writing specs.

### Code quality

The **SonarQube** job sends every pull request and every push to master to
[SonarQube Cloud](https://sonarcloud.io), free for public repositories, with both test
suites' coverage, and fails when the code misses its quality gate. To turn it on:

1. Sign in to SonarQube Cloud with GitHub, import your GitHub account as an organization,
   and analyze this repository.
2. In the project's **Administration > Analysis Method**, turn off **Automatic Analysis**,
   since CI runs it.
3. Create a token (**My Account > Security**) and add it to the repository as the
   `SONAR_TOKEN` Actions secret (**Settings > Secrets and variables > Actions**).
4. If SonarQube Cloud's organization or project key differs from the ones in
   `sonar-project.properties`, change them there.

Until the secret exists, the job skips the analysis.

### Layout

```
backend/     FastAPI app (app/), Alembic migrations, pytest suite, e2e test harness (e2e/)
frontend/    Vue + Vuetify app (src/), vitest suite, Playwright tests (e2e/)
docker/      entrypoint, nginx templates, supervisord programs, healthcheck, e2e image files
.github/     CI and release workflows, the container smoke test
Dockerfile   frontend build, backend build, runtime, dev and e2e stages
```

### Database migrations

```sh
cd backend
uv run alembic revision --autogenerate -m "describe the change"
```

Migrations run automatically every time the container starts.

## Releases

Publishing a release on GitHub builds the image and pushes it to GitHub's container
registry (`.github/workflows/release.yml`):

1. Draft a release with a new tag like `v1.4.0` (or `v2.0.0-rc.1` for a pre-release).
2. Publish it. GitHub doesn't run workflows for drafts, so publishing starts the build.

The workflow builds the image, scans it with Trivy, starts it and smoke-tests it, then
builds it for `linux/amd64` and `linux/arm64` and pushes `ghcr.io/brianbaggs35/cashcove`
tagged `1.4.0`, `1.4`, `1` and `latest` (pre-releases only get their own tag), with a
software bill of materials and signed build provenance. The image reports the release's
version on **Settings > System**. Only the production stages go in: Node and the other
build tools stay in the build stages.

To run a release instead of building the image yourself, set these in `.env` and run
`make pull`:

```sh
CASHCOVE_IMAGE=ghcr.io/brianbaggs35/cashcove
CASHCOVE_VERSION=1.4.0
```

New packages on GitHub start out private: make it public under the package's settings, or
`docker login ghcr.io` first. `gh attestation verify oci://ghcr.io/brianbaggs35/cashcove:1.4.0
--owner brianbaggs35` checks an image was built by this repository's workflow.

## Operations

- `make backup` writes a `pg_dump` to `./backups/`.
- The container creates an app secret key on first start, in the data volume at
  `/data/secrets/secret.key`. It encrypts authenticator-app keys, so a restored database
  needs it too. Run `make secret-key` and keep the value somewhere safe apart from your
  backups, such as a password manager. To move to a new server, set it as
  `CASHCOVE_SECRET_KEY` in `.env`.
- `make logs`, `make ps`, `make shell` and `make psql` help when something looks wrong.
- Data lives in the `cashcove-data` Docker volume and survives `make down` and rebuilds.
