set dotenv-load := false

# ── Backend ───────────────────────────────────────────────────────────────────

# Install / sync backend dependencies
backend-sync:
    cd django-backend && uv sync

# Download spaCy NLP models (run once after install)
backend-models:
    cd django-backend && uv run python -m spacy download it_core_news_sm

# Download Argos Translate language models for all DB-seeded languages (run once after migrate)
backend-argos-models:
    cd django-backend && uv run python manage.py install_argos_models

# Run database migrations
backend-migrate:
    cd django-backend && uv run python manage.py migrate

# Create new migrations after model changes
backend-makemigrations:
    cd django-backend && uv run python manage.py makemigrations

# Run the Django dev server
backend:
    cd django-backend && uv run python manage.py runserver

# Run the Celery worker (VPS queue)
worker:
    cd django-backend && uv run celery -A backend worker -Q vps -c 1 --loglevel=info

# Run the Celery worker (local-PC queue, for heavy models)
worker-local:
    cd django-backend && uv run celery -A backend worker -Q local -c 2 --loglevel=info

# Django system check
backend-check:
    cd django-backend && uv run python manage.py check

# Django shell
backend-shell:
    cd django-backend && uv run python manage.py shell

# Run backend tests
backend-test:
    cd django-backend && uv run python manage.py test

# ── Plugin ────────────────────────────────────────────────────────────────────

# Launch Firefox Dev Edition with plugin loaded + auto-reload on save
plugin:
    cd browser-plugin && npx web-ext run

# Lint the plugin
plugin-lint:
    cd browser-plugin && npx web-ext lint

# ── Setup (run once) ──────────────────────────────────────────────────────────

# Full first-time setup
setup: backend-sync backend-models backend-migrate backend-argos-models
    @echo "Setup complete. Start redis, then run: just backend / just worker / just plugin"

# Start Redis (if not running as a system service)
redis:
    redis-server

# ── Dev ───────────────────────────────────────────────────────────────────────

# Start everything: Redis + Django + Celery worker + Firefox plugin (Ctrl-C stops all)
dev:
    #!/usr/bin/env bash
    trap 'kill 0' SIGINT SIGTERM EXIT
    redis-server --daemonize no &
    (cd django-backend && uv run python manage.py runserver) &
    (cd django-backend && uv run celery -A backend worker -Q vps -c 1 --loglevel=info) &
    (cd browser-plugin && npx web-ext run) &
    wait
