# Deploying to Render

Two services from the same repo: **web** (Django + gunicorn) and **worker** (Celery, vps queue). Both share a managed PostgreSQL database and Redis instance, all defined in `django-backend/render.yaml`.

## Prerequisites

- Render account (render.com)
- Repo pushed to GitHub

## 1. Create the Blueprint

1. Go to render.com → **New** → **Blueprint**
2. Connect your GitHub repo
3. Render detects `django-backend/render.yaml` and previews all four resources (DB, Redis, web, worker)
4. Click **Apply** — Render provisions everything and kicks off the first deploy

That's it for infrastructure. The `render.yaml` handles all service definitions, environment variable wiring, and build/start commands.

## 2. Set the one manual env var

`ALLOWED_HOSTS` is marked `sync: false` in the blueprint (its value depends on the domain Render assigns, which isn't known until after the first deploy).

After the first deploy:

1. Go to the **web** service → **Environment** tab
2. Find `ALLOWED_HOSTS` and set it to your Render public domain, e.g. `transparent-input.onrender.com`
3. Save — Render redeploys automatically

All other env vars (`DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`) are wired automatically by the blueprint.

## 3. Verify

```bash
# Health check
curl https://your-service.onrender.com/api/

# Check seeded language rows
curl https://your-service.onrender.com/api/languages/
# Should return Italian and Vietnamese
```

## How migrations run

`preDeployCommand: uv run python manage.py migrate` in `render.yaml` runs migrations before each new version of the web service goes live. Zero-downtime: the old version keeps serving traffic until migrations complete and the new container passes its health check.

## Notes on the Argos model cache

The worker runs `install_argos_models` on each start. Argos models are downloaded to the container's local filesystem (~150 MB per language, ~750 MB total). If cold-start time becomes a problem, attach a Render Disk to the worker service at `~/.local/share/argos-translate/` so models persist across deploys.

## Ongoing operations

- **View worker logs**: Render dashboard → `transparent-input-worker` → Logs tab
- **Scale the worker**: worker service → Settings → increase replicas, or bump `-c 2` to `-c 4` in `render.yaml`
- **Run a Django shell**: Render dashboard → web service → **Shell** tab
- **Run migrations manually**: Shell tab → `uv run python manage.py migrate`
- **Change region**: update `region:` in `render.yaml` for all four resources (must match)

## Updating the extension's backend URL

In `browser-plugin/`, update the hardcoded backend URL to your Render domain before building/publishing the extension.
