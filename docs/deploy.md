# Deploying to a DigitalOcean Droplet

Django + gunicorn behind nginx, with Postgres on the same box. Flat $6/mo, no usage-based billing.

Config files: `django-backend/deploy/gunicorn.service`, `django-backend/deploy/nginx.conf`.
Auto-deploy on push: `.github/workflows/deploy.yml`.

---

## One-time server setup

### 1. Create the droplet

DigitalOcean → **Create Droplet** → Ubuntu 24.04 → Basic → $6/mo (1 GB RAM) → Frankfurt region → add your SSH key.

### 2. Create a deploy user

```bash
ssh root@YOUR_IP
adduser deploy
usermod -aG sudo deploy
# Allow deploy to restart gunicorn without a password prompt
echo "deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart gunicorn" >> /etc/sudoers.d/deploy
```

### 3. Install dependencies

```bash
apt update && apt install -y postgresql nginx certbot python3-certbot-nginx
curl -LsSf https://astral.sh/uv/install.sh | sh   # installs uv for root
su - deploy
curl -LsSf https://astral.sh/uv/install.sh | sh   # installs uv for deploy user
exit
```

### 4. Set up Postgres

```bash
sudo -u postgres psql
```
```sql
CREATE USER transparent_input WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE transparent_input OWNER transparent_input;
\q
```

### 5. Clone the repo and install deps

```bash
su - deploy
git clone https://github.com/YOUR_ORG/transparent-input.git
cd transparent-input/django-backend
uv sync --no-dev
```

### 6. Create the env file

```bash
sudo nano /etc/transparent-input.env
```

```
SECRET_KEY=<generate: python -c "import secrets; print(secrets.token_urlsafe(50))">
DATABASE_URL=postgresql://transparent_input:<password>@localhost/transparent_input
ALLOWED_HOSTS=your-domain.com
DEBUG=false
```

```bash
sudo chmod 600 /etc/transparent-input.env
```

### 7. Run initial migrations and collect static

```bash
su - deploy
cd /home/deploy/transparent-input/django-backend
uv run python manage.py migrate
uv run python manage.py collectstatic --noinput
```

### 8. Install and start gunicorn as a service

```bash
sudo cp /home/deploy/transparent-input/django-backend/deploy/gunicorn.service /etc/systemd/system/gunicorn.service
sudo systemctl enable --now gunicorn
```

### 9. Configure nginx

```bash
sudo cp /home/deploy/transparent-input/django-backend/deploy/nginx.conf /etc/nginx/sites-available/transparent-input
# Edit the file and replace YOUR_DOMAIN
sudo nano /etc/nginx/sites-available/transparent-input
sudo ln -s /etc/nginx/sites-available/transparent-input /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 10. SSL

```bash
sudo certbot --nginx -d your-domain.com
```

Certbot edits the nginx config automatically and sets up auto-renewal.

---

## Auto-deploy setup (one-time)

Pushes to `main` that touch `django-backend/` trigger the GitHub Actions workflow in `.github/workflows/deploy.yml`.

1. On the droplet, generate a deploy key:
   ```bash
   su - deploy
   ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
   cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
   cat ~/.ssh/deploy_key   # copy this — it's the private key for GitHub
   ```

2. In GitHub → repo → **Settings → Secrets and variables → Actions**, add:
   - `DROPLET_HOST` — your droplet's IP address
   - `DEPLOY_SSH_KEY` — the private key from above

That's it. Every push to `main` deploys automatically.

---

## Ongoing operations

- **Logs**: `sudo journalctl -u gunicorn -f`
- **Django shell**: `su - deploy && cd ~/transparent-input/django-backend && uv run python manage.py shell`
- **Manual deploy**: `cd ~/transparent-input && git pull && cd django-backend && uv sync --no-dev && uv run python manage.py migrate && sudo systemctl restart gunicorn`
- **Postgres shell**: `sudo -u postgres psql transparent_input`

## Updating the extension's backend URL

In `browser-plugin/`, update the hardcoded backend URL to your domain before building/publishing the extension.
