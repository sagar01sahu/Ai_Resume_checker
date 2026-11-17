# ResumeRank — AI-Based Resume Matching & Candidate Ranking System

ResumeRank is a full-stack candidate screening and explainable resume matching application built with **React + Vite + Tailwind CSS + TanStack Table**, **Python + FastAPI**, **PostgreSQL**, **spaCy (`en_core_web_md`)**, **SentenceTransformers (`all-MiniLM-L6-v2`)**, and optional **Google Gemini API** enhancement with deterministic rule-based fallback.

## Architecture

- **Frontend (`/src`)**: React 19, Vite, Tailwind CSS, TanStack Table (`@tanstack/react-table`). Supports Setup (paste or upload JD + batch upload 10+ PDF/DOCX resumes), Live Matching Progress, Ranking Dashboard (filter by min score, live search, CSV export), Candidate Detail (sub-score breakdown, matched/missing skills, experience comparison, plain-English explanation), Scoring Weights (live re-ranking with rank-delta arrows), Compare Candidates matrix, and Past Screenings.
- **Python Backend (`/backend`)**:
  - `parser.py`: `pdfplumber` with `PyMuPDF` fallback for PDFs, `python-docx` for DOCX, and explicit detection/rejection of scanned-image PDFs (`Failed: scanned image`).
  - `extractor.py`: `spaCy` (`en_core_web_md`) NER + `PhraseMatcher` backed by `skills_taxonomy.json` + date-range deduplication + optional Gemini structured JD extraction.
  - `matcher.py`: `sentence-transformers/all-MiniLM-L6-v2` embeddings with in-memory caching and the deterministic hybrid formula (`0.40 * Skill + 0.25 * Semantic + 0.25 * Experience + 0.10 * Education`).
  - `explainer.py`: Always-on deterministic rule-based explanation + optional Gemini narration (narrates computed numbers only, never modifies scores).
- **Database**: PostgreSQL schema (`job_descriptions`, `candidates`, `match_results` with JSONB columns).
- **Synthetic Test Data (`/sample_resumes`)**: 12 synthetic resumes (PDF & DOCX, including 1 scanned image PDF `scan_resume_07.pdf`) and `senior_backend_jd.pdf`.

## API Endpoints (FastAPI `/docs`)

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health and model status |
| `GET` | `/api/jobs` | List past screenings |
| `POST` | `/api/jobs` | Submit JD text or PDF/DOCX/TXT file; returns parsed JD |
| `POST` | `/api/jobs/{id}/resumes` | Batch upload resumes (multipart PDF/DOCX) |
| `POST` | `/api/jobs/{id}/match` | Start matching background task |
| `GET` | `/api/jobs/{id}/status` | Poll step-by-step matching progress |
| `POST` | `/api/jobs/{id}/cancel` | Cancel running matching job |
| `GET` | `/api/jobs/{id}/ranking` | Ranked candidate list (supports `min_score` and dynamic weight query params) |
| `GET` | `/api/candidates/{id}` | Full candidate breakdown and explanation |
| `GET` | `/api/jobs/{id}/export` | Download ranked shortlist as CSV |

## Quick Start with Docker Compose (Local)

```bash
cp .env.example .env
# Optional: set GEMINI_API_KEY in .env (works without a key via rule-based fallback)
docker compose up --build
```

Open `http://localhost:8000` (and Swagger UI at `http://localhost:8000/docs`).

## Deploy to Render (Docker + Managed PostgreSQL)

1. Push this repository to GitHub.
2. In Render, choose **New + -> Blueprint** and select your repository (`render.yaml` is automatically detected).
3. Render provisions `resumerank-db` (PostgreSQL) and builds `Dockerfile`, which bundles `en_core_web_md`, `all-MiniLM-L6-v2`, and the compiled React bundle into a single container.
4. When prompted for `GEMINI_API_KEY`, enter your Google AI Studio Gemini API key (or leave blank to run purely with local models + rule-based fallback).

## CI/CD

`.github/workflows/ci-cd.yml` runs TypeScript type-checking, Vite production build, Python `pytest` unit tests, synthetic ranking sanity evaluation (`backend/evaluate.py`), builds and pushes the bundled Docker image to GHCR, and optionally triggers `RENDER_DEPLOY_HOOK_URL`.
