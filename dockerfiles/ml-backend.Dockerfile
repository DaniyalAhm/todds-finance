# syntax=docker/dockerfile:1

# ML backend: provides fuzzy payee entity resolution to the Express backend.
FROM python:3.11-slim AS runtime
LABEL org.opencontainers.image.title="AI Budgeting ML Backend" \
      org.opencontainers.image.description="Flask and Splink entity-resolution service for AI Budgeting" \
      org.opencontainers.image.source="local"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY ml-python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY --chown=app:app ml-python/entity-resolution.py ./entity-resolution.py
USER app
EXPOSE 5000
CMD ["python", "entity-resolution.py"]
