# Deploying to Railway

Two services from the same repo: **web** (Django + gunicorn) and **worker** (Celery, vps queue). Both share a Railway-managed PostgreSQL database and Redis instance.

## Prerequisites

- Railway account (railway.app)
- Repo pushed to GitHub

## 1. Create the project

1. Go to railway.app → **New Project** → **Deploy from GitHub repo** → select this repo
2. Railway auto-detects the repo and creates a first service — this will become the **web** service
3. In the service settings, set **Root Directory** to `django-backend`

## 2. Add plugins

In the project view, click **+ Add Service** → **Database**:

- Add **PostgreSQL** — Railway injects `DATABASE_URL` automatically
- Add **Redis** — Railway injects `REDIS_URL` automatically

## 3. Set environment variables on the web service

In the web service → **Variables** tab, add:

| Variable | Value |
|---|---|
| `SECRET_KEY` | Generate one: `python -c "import secrets; print(secrets.token_urlsafe(50))"` |
| `DEBUG` | `false` |
| `ALLOWED_HOSTS` | Your Railway public domain, e.g. `transparent-input.up.railway.app` (find it under Settings → Domains) |

`DATABASE_URL` and `REDIS_URL` are injected automatically by the plugins — don't set them manually.

## 4. Set the web service start command

In the web service → **Settings** → **Deploy**:

- **Build command**: `uv sync && uv run python manage.py collectstatic --noinput`
- **Start command**: `uv run python manage.py migrate && uv run gunicorn backend.wsgi --bind 0.0.0.0:$PORT --workers 2`

(These are already set in `railway.toml` — Railway picks them up automatically if the file is present.)

## 5. Add the worker service

1. In the project view, click **+ Add Service** → **GitHub Repo** → same repo
2. Set **Root Directory** to `django-backend`
3. In the worker service → **Settings** → **Deploy**, set **Start command**:
   ```
   uv run celery -A backend worker -Q vps -c 2 --loglevel=info
   ```
4. In the worker service → **Variables**, click **Shared Variables** and link it to the same PostgreSQL and Redis plugins (so it inherits `DATABASE_URL` and `REDIS_URL`)
5. Add `SECRET_KEY` and `DEBUG=false` here too (copy from the web service, or use Railway's variable references)

## 6. Deploy

Click **Deploy** on each service (or push to your main branch if you've set up auto-deploy). Watch the build logs — the first deploy runs migrations automatically via the start command.

## 7. Verify

```bash
# Health check
curl https://your-domain.up.railway.app/api/

# Check the Language rows seeded by migrations
curl https://your-domain.up.railway.app/api/languages/
# Should return Italian and Vietnamese
```

## Updating the extension's backend URL

In `browser-plugin/content.js`, update the hardcoded backend URL to your Railway domain before building/publishing the extension.

## Ongoing operations

- **View worker logs**: Railway dashboard → worker service → Logs tab
- **Scale the worker**: worker service → Settings → increase replicas, or bump `-c 2` to `-c 4` in the start command
- **Run a Django shell**: Railway dashboard → web service → **Shell** tab (if enabled), or via Railway CLI: `railway run python manage.py shell`
- **Run migrations after a schema change**: they run automatically on each deploy via the start command
