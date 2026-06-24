set dotenv-load := false

# ── Backend ───────────────────────────────────────────────────────────────────

# Install / sync backend dependencies
backend-sync:
    cd django-backend && uv sync

# Run database migrations
backend-migrate:
    cd django-backend && uv run python manage.py migrate

# Create new migrations after model changes
backend-makemigrations:
    cd django-backend && uv run python manage.py makemigrations

# Run the Django dev server
backend:
    cd django-backend && uv run python manage.py runserver

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
    cd browser-plugin && npm run dev

# Build the plugin for production (Firefox)
plugin-build:
    cd browser-plugin && npm run build

# Package the plugin as a zip (Firefox / AMO)
plugin-zip:
    cd browser-plugin && npm run zip

# Build the plugin for Chrome
plugin-build-chrome:
    cd browser-plugin && npm run build:chrome

# Package the plugin as a zip (Chrome Web Store)
plugin-zip-chrome:
    cd browser-plugin && npm run zip:chrome

# ── Setup (run once) ──────────────────────────────────────────────────────────

# Full first-time setup
setup: backend-sync backend-migrate
    @echo "Setup complete. Run: just backend / just plugin"

# ── Dev ───────────────────────────────────────────────────────────────────────

# Start everything: Django + Firefox plugin (Ctrl-C stops all)
dev:
    #!/usr/bin/env bash
    trap 'kill 0' SIGINT SIGTERM EXIT
    (cd django-backend && uv run python manage.py runserver) &
    (cd browser-plugin && npm run dev) &
    wait
