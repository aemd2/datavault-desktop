# Minimal image to run the sync CLI (supply env at runtime).
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY sync_engine ./sync_engine
RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "sync_engine", "sync"]
