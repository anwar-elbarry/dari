# Self-hosted document worker. Runs as a non-root user and needs no writable disk: images are processed in memory
# and Tesseract is driven through stdin/stdout, so the container can run with a read-only root filesystem.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
RUN useradd --system --no-create-home worker
USER worker
EXPOSE 8001
# --no-access-log: request lines are not needed and the worker must not log anything about documents.
# OCR_SHARED_SECRET is required (the worker refuses to start without it).
CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
