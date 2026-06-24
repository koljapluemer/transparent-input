# Deploying to a DigitalOcean Droplet

Django + gunicorn behind nginx, with Postgres on the same box. Flat $6/mo, no usage-based billing.

Config files: `django-backend/deploy/gunicorn.service`, `django-backend/deploy/nginx.conf`.
Auto-deploy on push: `.github/workflows/deploy.yml`.

---

## One-time server setup

### 1. Create the droplet

DigitalOcean → **Create Droplet** → Ubuntu 24.04 → Basic → $6/mo (1 GB RAM) → Frankfurt region → add your SSH key.

---

### 2. Root setup (user, packages, Postgres)

SSH in as root and run all of this in one go:

```bash
ssh root@YOUR_IP
```

**Create the deploy user and copy your SSH key to it:**

```bash
adduser deploy
usermod -aG sudo deploy
echo "deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart gunicorn" >> /etc/sudoers.d/deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

**Install packages:**

```bash
apt update && apt install -y postgresql nginx certbot python3-certbot-nginx
```

**Set up the database:**

```bash
sudo -u postgres psql
```

```sql
CREATE USER transparent_input WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE transparent_input OWNER transparent_input;
\q
```

**Exit root:**

```bash
exit
```

---

### 3. Install uv and set up GitHub access (as deploy)

SSH back in as the deploy user:

```bash
ssh deploy@YOUR_IP
```

Install uv:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
exec bash   # reload shell so uv is on PATH
```

Generate an SSH key for GitHub access and add it as a deploy key:

```bash
ssh-keygen -t ed25519 -C "deploy@droplet" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy the output, then in GitHub → repo → **Settings → Deploy keys → Add deploy key** → paste it in (read-only access is enough).

---

### 4. Clone the repo and install deps

```bash
git clone git@github.com:koljapluemer/transparent-input.git
cd transparent-input/django-backend
uv sync --no-dev
```

---

### 5. Create the env file

Generate a secret key:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

Create the file (substitute your key and DB password):

```bash
sudo nano /etc/transparent-input.env
```

```
SECRET_KEY=<paste generated key here>
DATABASE_URL=postgresql://transparent_input:<db-password>@localhost/transparent_input
ALLOWED_HOSTS=your-domain.com
DEBUG=false
```

Lock down the file:

```bash
sudo chmod 600 /etc/transparent-input.env
```

---

### 6. Run migrations and collect static

```bash
set -a && source /etc/transparent-input.env && set +a
cd /home/deploy/transparent-input/django-backend
uv run python manage.py migrate
uv run python manage.py collectstatic --noinput
```

---

### 7. Install and start gunicorn

```bash
sudo cp /home/deploy/transparent-input/django-backend/deploy/gunicorn.service /etc/systemd/system/gunicorn.service
sudo systemctl enable --now gunicorn
sudo systemctl status gunicorn   # should show "active (running)"
```

---

### 8. Configure nginx

Use your droplet's public IP or domain name. A bare IP works fine — skip step 9 if you don't have a domain yet.

```bash
sudo cp /home/deploy/transparent-input/django-backend/deploy/nginx.conf /etc/nginx/sites-available/transparent-input
sudo sed -i 's/YOUR_DOMAIN/YOUR_IP_OR_DOMAIN/' /etc/nginx/sites-available/transparent-input
sudo ln -s /etc/nginx/sites-available/transparent-input /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

### 9. SSL (requires a real domain, not an IP)

```bash
sudo certbot --nginx -d your-domain.com
```

Certbot edits the nginx config automatically and sets up auto-renewal. Skip this step if you're using a bare IP address.

---

## Auto-deploy setup (one-time)

Pushes to `main` that touch `django-backend/` trigger the GitHub Actions workflow in `.github/workflows/deploy.yml`.

SSH in as deploy and generate a deploy key:

```bash
ssh deploy@YOUR_IP
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key   # copy this — it's the private key for GitHub
```

In **github.com/koljapluemer/transparent-input → Settings → Secrets and variables → Actions → New repository secret**, add two secrets:
- `DROPLET_HOST` — your droplet's IP address
- `DEPLOY_SSH_KEY` — the private key copied above

Every push to `main` that touches `django-backend/` deploys automatically.

---

## Ongoing operations

All commands below assume you are **SSH'd in as deploy**.

- **Logs**: `sudo journalctl -u gunicorn -f`
- **Django shell**: `cd ~/transparent-input/django-backend && uv run python manage.py shell`
- **Postgres shell**: `sudo -u postgres psql transparent_input`
- **Manual deploy**:
  ```bash
  set -a && source /etc/transparent-input.env && set +a
  cd ~/transparent-input
  git pull
  cd django-backend
  uv sync --no-dev
  uv run python manage.py migrate
  uv run python manage.py collectstatic --noinput
  sudo systemctl restart gunicorn
  ```

---

## Updating the extension's backend URL

In `browser-plugin/`, update the hardcoded backend URL to your domain before building/publishing the extension.
