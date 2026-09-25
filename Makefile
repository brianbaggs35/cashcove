# Cashcove: `make` lists every command.
SHELL := /bin/bash
COMPOSE := docker compose
DEV_COMPOSE := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
BACKEND := cd backend &&
FRONTEND := cd frontend &&
HADOLINT_IMAGE := hadolint/hadolint:v2.15.1
SHELLCHECK_IMAGE := koalaman/shellcheck:v0.11.0
ACTIONLINT_IMAGE := rhysd/actionlint:1.7.12
# Run from its image, pinned by digest, rather than a third-party GitHub Action.
TRIVY_IMAGE := aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969
TRIVY := docker run --rm -v cashcove-trivy-cache:/root/.cache/trivy
TRIVY_FLAGS := --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1

.DEFAULT_GOAL := help
.PHONY: help up down restart rebuild logs ps shell psql backup secret-key \
	setup-code reset-link turn-off-2fa dev dev-down dev-logs \
	install test test-backend test-frontend lint lint-backend lint-frontend lint-infra format audit \
	scan scan-source scan-image clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## ---- Run -----------------------------------------------------------------------
up: ## Build and start Cashcove in the background
	$(COMPOSE) up -d --build
	@echo "Cashcove is starting at https://$${CASHCOVE_SERVER_NAME:-localhost}"

down: ## Stop Cashcove (your data is kept)
	$(COMPOSE) down

restart: ## Restart Cashcove, e.g. after renewing certificates
	$(COMPOSE) restart

rebuild: ## Rebuild the image from scratch and restart
	$(COMPOSE) build --pull --no-cache
	$(COMPOSE) up -d --force-recreate

logs: ## Follow the logs
	$(COMPOSE) logs -f

ps: ## Show container status and health
	$(COMPOSE) ps

shell: ## Open a shell in the running container
	$(COMPOSE) exec cashcove sh

psql: ## Open a database shell
	$(COMPOSE) exec -u cashcove cashcove psql -h /run/postgresql cashcove

backup: ## Dump the database to ./backups
	@mkdir -p backups
	$(COMPOSE) exec -T -u cashcove cashcove pg_dump -h /run/postgresql -Fc cashcove \
		> backups/cashcove-$$(date +%Y%m%d-%H%M%S).dump
	@ls -1t backups | head -1

secret-key: ## Print the app secret key, to keep somewhere safe apart from the backups
	@$(COMPOSE) exec -u cashcove cashcove cat /data/secrets/secret.key

setup-code: ## Print a fresh one-time code for creating the first admin
	$(COMPOSE) exec -u cashcove -w /app/backend cashcove python -m app.cli setup-code

reset-link: ## Print a password reset link: make reset-link EMAIL=you@example.com
	$(if $(EMAIL),,$(error Say whose account, e.g. make reset-link EMAIL=you@example.com))
	$(COMPOSE) exec -u cashcove -w /app/backend cashcove python -m app.cli reset-link '$(EMAIL)'

turn-off-2fa: ## Turn off authenticator codes: make turn-off-2fa EMAIL=you@example.com
	$(if $(EMAIL),,$(error Say whose account, e.g. make turn-off-2fa EMAIL=you@example.com))
	$(COMPOSE) exec -u cashcove -w /app/backend cashcove python -m app.cli turn-off-2fa '$(EMAIL)'

## ---- Develop -------------------------------------------------------------------
dev: ## Run the dev container with live reload (Vite + API)
	$(DEV_COMPOSE) up --build

dev-down: ## Stop the dev container
	$(DEV_COMPOSE) down

dev-logs: ## Follow the dev container's logs
	$(DEV_COMPOSE) logs -f

install: ## Install backend and frontend dependencies locally
	$(BACKEND) uv sync
	$(FRONTEND) npm ci

test: test-backend test-frontend ## Run all tests with coverage (100% required)

test-backend: ## Run pytest with coverage
	$(BACKEND) uv run pytest

test-frontend: ## Run vitest with coverage
	$(FRONTEND) npm run coverage

lint: lint-backend lint-frontend lint-infra ## Run every linter and type checker

lint-backend: ## ruff, pyright, mypy and bandit (API and container scripts)
	$(BACKEND) uv run ruff check . ../docker && uv run ruff format --check . ../docker \
		&& uv run pyright && uv run mypy app tests migrations \
		&& uv run bandit -c pyproject.toml -r app migrations ../docker -q

lint-frontend: ## ESLint, Prettier and vue-tsc
	$(FRONTEND) npm run lint && npm run format:check && npm run typecheck

lint-infra: ## hadolint, ShellCheck and actionlint (Dockerfile, scripts, CI workflow)
	docker run --rm -v "$(CURDIR):/work:ro" -w /work $(HADOLINT_IMAGE) hadolint Dockerfile
	docker run --rm -v "$(CURDIR):/mnt:ro" $(SHELLCHECK_IMAGE) docker/entrypoint.sh docker/start-api.sh \
		.github/scripts/smoke-test.sh
	docker run --rm -v "$(CURDIR):/repo:ro" -w /repo $(ACTIONLINT_IMAGE) -color

format: ## Auto-format backend and frontend code
	$(BACKEND) uv run ruff check --fix . ../docker && uv run ruff format . ../docker
	$(FRONTEND) npm run lint -- --fix && npm run format

audit: ## Check dependencies for known vulnerabilities
	$(BACKEND) uv run pip-audit
	$(FRONTEND) npm audit

scan: scan-source scan-image ## Scan the code and the built image with Trivy

scan-source: ## Trivy: vulnerable dependencies, leaked secrets and Dockerfile mistakes
	$(TRIVY) -v "$(CURDIR):/src:ro" -w /src $(TRIVY_IMAGE) fs $(TRIVY_FLAGS) \
		--scanners vuln,secret,misconfig --ignorefile .trivyignore.yaml .

scan-image: ## Trivy: vulnerabilities in the built image's packages
	$(TRIVY) -v /var/run/docker.sock:/var/run/docker.sock:ro $(TRIVY_IMAGE) image $(TRIVY_FLAGS) \
		cashcove:$${CASHCOVE_VERSION:-latest}

clean: ## Remove local build and test artifacts
	rm -rf backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache backend/.coverage \
		backend/coverage.xml frontend/dist frontend/coverage
