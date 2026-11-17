import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import Base, engine
from .routers import candidates, jobs, resumes
from .services.extractor import get_nlp
from .services.matcher import get_embedding_model


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Preload spaCy and SentenceTransformer models at startup to avoid first-request latency
    get_nlp()
    get_embedding_model()
    yield


app = FastAPI(
    title="ResumeRank API",
    description="AI-Based Resume Matching & Candidate Ranking System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router)
app.include_router(resumes.router)
app.include_router(candidates.router)


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "embedding_model": settings.embedding_model,
        "llm_provider": settings.llm_provider if settings.gemini_api_key else "rule-based",
    }


DIST_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "dist"))
if os.path.isdir(DIST_DIR):
    assets_dir = os.path.join(DIST_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        candidate_path = os.path.join(DIST_DIR, full_path)
        if full_path and os.path.isfile(candidate_path):
            return FileResponse(candidate_path)
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
