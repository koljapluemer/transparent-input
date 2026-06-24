# Deploying to Fly.io

Django + gunicorn web service backed by a managed PostgreSQL database. Defined in `django-backend/fly.toml` and `django-backend/Dockerfile`.

## Prerequisites

- Fly.io account (fly.io)
- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated (`fly auth login`)
- Repo pushed to GitHub

## 1. Create the app

From `django-backend/`:

```bash
fly launch --no-deploy
```

Accept the detected config. This registers the app name and links it to your account. It will detect the `Dockerfile` automatically.

## 2. Provision Postgres

```bash
fly postgres create --name transparent-input-db --region fra
fly postgres attach transparent-input-db
```

`attach` injects `DATABASE_URL` as a secret automatically.

## 3. Set secrets

```bash
fly secrets set \
  SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(50))") \
  ALLOWED_HOSTS=transparent-input.fly.dev
```

Replace `transparent-input.fly.dev` with your actual app domain if you chose a different app name during `fly launch`.

## 4. Deploy

```bash
fly deploy
```

Fly builds the Docker image, runs `python manage.py migrate` as a release command (before traffic switches over), then starts gunicorn. Subsequent deploys are zero-downtime.

## 5. Verify

```bash
curl https://transparent-input.fly.dev/api/
curl https://transparent-input.fly.dev/api/languages/
# Should return Italian and Vietnamese
```

## Ongoing operations

- **View logs**: `fly logs`
- **Django shell**: `fly ssh console -C "uv run python manage.py shell"`
- **Run migrations manually**: `fly ssh console -C "uv run python manage.py migrate"`
- **Scale**: `fly scale count 2` (replicas) or `fly scale vm shared-cpu-2x` (machine size)
- **Postgres shell**: `fly postgres connect -a transparent-input-db`

## Updating the extension's backend URL

In `browser-plugin/`, update the hardcoded backend URL to your Fly domain before building/publishing the extension.
