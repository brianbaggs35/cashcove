# Copilot instructions

## Project overview

Cashcove is a self-hosted personal-finance application. It uses python and typescript with vue as well and vuetify for the UI. The repository is organized as:

- `backend/`: Python 3.13+ FastAPI application, SQLAlchemy models, Alembic migrations, pytest tests, and an end-to-end API harness.
- `frontend/`: Vue 3 and Vuetify application, Vitest tests, and Playwright end-to-end tests.
- `docker/`: container entrypoints, nginx and supervisor configuration, health checks, and end-to-end image files.
- `.github/`: CI and release workflows plus the container smoke test.

PostgreSQL is the application database. Follow the existing patterns in the affected area and keep changes focused. For schema changes, update the SQLAlchemy models and add an Alembic migration. When changing dependencies, use the relevant package manager and keep its lockfile in sync.

## Verification before finishing

Before reporting a change as complete:

1. Run the relevant tests for behavior changes; use focused tests during development and the broader suite when appropriate.
2. Run the formatter check for every changed language. For backend Python, run `cd backend && uv run ruff format --check . ../docker`; this is the CI scope and includes `docker/`. Run `uv run ruff check . ../docker` from `backend/` as well.
3. For frontend changes, run `cd frontend && npm run lint -- --max-warnings=0 && npm run format:check && npm run typecheck`.
4. For broad changes or before a pull request, run `make lint` and `make test`. CI also runs `make audit` and `make e2e`; consult `.github/workflows/ci.yml` for the full checks and their environment requirements.
5. In the final response, state which checks actually passed. Do not imply a check ran if it did not; call out failures or unavailable dependencies/services.

`make test` requires Docker for the backend's throwaway PostgreSQL database. Backend and frontend test suites enforce 100% coverage, so add or update tests when changing behavior.

Also make sure to run `make lint` or equivalent which would be ruff, eslint, prettier, pyright, bandit, typecheck, etc. The command `make lint` seems to run them all.
