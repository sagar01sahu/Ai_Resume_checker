import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://resume_ranker:resume_ranker@localhost:5432/resume_ranker",
    )
    llm_provider: str = os.getenv("LLM_PROVIDER", "gemini")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "") or os.getenv("LLM_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
    skill_match_threshold: float = float(os.getenv("SKILL_MATCH_THRESHOLD", "0.75"))
    default_weights: dict[str, float] = {
        "skills": 0.40,
        "semantic": 0.25,
        "experience": 0.25,
        "education": 0.10,
    }

    @property
    def normalized_database_url(self) -> str:
        url = self.database_url.strip()
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://") and "+psycopg" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url


settings = Settings()
