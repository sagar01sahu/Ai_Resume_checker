# ---- Stage 1: Build React + Vite Frontend ----
FROM node:22-slim AS frontend-builder
WORKDIR /frontend

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

# ---- Stage 2: Python FastAPI + Bundled NLP/Embedding Models ----
FROM python:3.11-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/app/.cache/huggingface \
    PORT=8000

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Bundle spaCy model and HuggingFace sentence-transformer model directly into image
RUN python -m spacy download en_core_web_md && \
    python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

ENV TRANSFORMERS_OFFLINE=1 \
    HF_HUB_OFFLINE=1

COPY backend ./backend
COPY sample_resumes ./sample_resumes
COPY --from=frontend-builder /frontend/dist ./dist

WORKDIR /app/backend

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
