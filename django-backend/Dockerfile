FROM python:3.13-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .
RUN uv run python manage.py collectstatic --noinput

CMD ["uv", "run", "gunicorn", "backend.wsgi", "--bind", "0.0.0.0:8080", "--workers", "2"]
