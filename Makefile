# Cashcove: `make` lists every command.
SHELL := /bin/bash
COMPOSE := docker compose
DEV_COMPOSE := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
BACKEND := cd backend &&
FRONTEND := cd frontend &&

.DEFAULT_GOAL := help
.PHONY: help up down restart rebuild logs ps shell psql backup dev dev-down dev-logs \
	install test test-backend test-frontend lint lint-backend lint-frontend format audit clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

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
	$(COMPOSE) exec cashcove bash

psql: ## Open a database shell
	$(COMPOSE) exec -u cashcove cashcove psql -h /run/postgresql cashcove

backup: ## Dump the database to ./backups
	@mkdir -p backups
	$(COMPOSE) exec -T -u cashcove cashcove pg_dump -h /run/postgresql -Fc cashcove \
		> backups/cashcove-$$(date +%Y%m%d-%H%M%S).dump
	@ls -1t backups | head -1

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

lint: lint-backend lint-frontend ## Run every linter and type checker

lint-backend: ## ruff, pyright, mypy and bandit
	$(BACKEND) uv run ruff check . && uv run ruff format --check . && uv run pyright \
		&& uv run mypy app tests migrations && uv run bandit -c pyproject.toml -r app migrations -q

lint-frontend: ## ESLint, Prettier and vue-tsc
	$(FRONTEND) npm run lint && npm run format:check && npm run typecheck

format: ## Auto-format backend and frontend code
	$(BACKEND) uv run ruff check --fix . && uv run ruff format .
	$(FRONTEND) npm run lint -- --fix && npm run format

audit: ## Check dependencies for known vulnerabilities
	$(BACKEND) uv run pip-audit
	$(FRONTEND) npm audit --omit=dev

clean: ## Remove local build and test artifacts
	rm -rf backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache backend/.coverage \
		backend/coverage.xml frontend/dist frontend/coverage
