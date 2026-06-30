# Portable image for the 0penRX backend (Fly.io / Cloud Run / Railway / any host).
# Render users can ignore this and use render.yaml instead.
FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching.
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# App code + the committed coupon dataset (the only data file the API needs;
# the backend serves coupons + the optional GoodRx proxy. Prescription pricing
# is fetched client-side from CMS NADAC and never touches the backend).
COPY backend/ backend/
COPY data/coupons.jsonl data/coupons.jsonl

# Lock CORS to the production site by default (override at runtime).
ENV OPENRX_CORS_ORIGINS=https://0penrx.org
EXPOSE 8000

# CWD is /app so the app's relative data paths resolve; honor the host's $PORT.
CMD ["sh", "-c", "uvicorn app:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
