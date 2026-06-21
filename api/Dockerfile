FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SQLite db + ROR cache live on a mounted volume in production (see fly.toml).
RUN mkdir -p /data
ENV LASTECHO_DB_PATH=/data/lastecho.db

EXPOSE 8000
# --proxy-headers makes Uvicorn derive the client IP from X-Forwarded-For, which
# the platform proxy (Render/Fly) sets — without it request.client.host is the
# proxy's IP and per-IP rate limiting (incl. the admin-login brute-force cap)
# collapses to a single shared bucket. forwarded-allow-ips=* is safe here because
# the only host that can open a direct connection to this container is the
# trusted platform proxy; external clients cannot reach it directly.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
