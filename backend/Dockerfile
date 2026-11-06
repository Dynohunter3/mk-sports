# PredictPro API / worker image. Build from the repository root:
#   docker build -f backend/Dockerfile -t predictpro-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

# Engine first (changes less often -> better layer caching)
COPY engine /app/engine
RUN pip install /app/engine

COPY backend/pyproject.toml /app/backend/pyproject.toml
COPY backend/app /app/backend/app
COPY backend/migrations /app/backend/migrations
COPY backend/alembic.ini /app/backend/alembic.ini
RUN pip install /app/backend

WORKDIR /app/backend
RUN useradd --create-home --uid 10001 predictpro
USER predictpro

EXPOSE 8000
# Apply migrations, then serve. (The scheduler runs in the separate `worker` service.)
CMD ["sh", "-c", "python -m app.cli migrate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --workers 2"]
