FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SQLite db + ROR cache live on a mounted volume in production (see fly.toml).
RUN mkdir -p /data
ENV LASTECHO_DB_PATH=/data/lastecho.db

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
