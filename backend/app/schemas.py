from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class ParsedJD(BaseModel):
    title: str = "Untitled Role"
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    min_years: float = 0.0
    education: str = ""
    responsibilities: list[str] = Field(default_factory=list)


class JobCreateRequest(BaseModel):
    raw_text: str


class JobResponse(BaseModel):
    id: int
    title: str
    raw_text: str
    parsed: ParsedJD
    created_at: datetime
    candidate_count: int = 0
    parsed_count: int = 0


class CandidateUploadItem(BaseModel):
    id: int
    filename: str
    file_size_bytes: int
    name: str
    parse_status: str


class BatchUploadResponse(BaseModel):
    job_id: int
    total_files: int
    parsed_count: int
    failed_count: int
    candidates: list[CandidateUploadItem]


class WeightConfig(BaseModel):
    skills: float = 0.40
    semantic: float = 0.25
    experience: float = 0.25
    education: float = 0.10


class MatchRunRequest(BaseModel):
    weights: WeightConfig | None = None


class RankedCandidateItem(BaseModel):
    rank: int
    default_rank: int
    rank_delta: int
    candidate_id: int
    name: str
    email: str | None
    filename: str
    experience_years: float
    education_summary: str
    overall_score: float
    skill_score: float
    semantic_score: float
    experience_score: float
    education_score: float
    matched_skills: list[dict[str, Any]]
    missing_skills: list[dict[str, Any]]
    must_have_missing_count: int


class RankingResponse(BaseModel):
    job: JobResponse
    total_candidates: int
    ranked_count: int
    failed_files: list[dict[str, str]]
    weights: WeightConfig
    candidates: list[RankedCandidateItem]


class CandidateDetailResponse(BaseModel):
    candidate_id: int
    job_id: int
    job_title: str
    rank: int
    total_ranked: int
    filename: str
    name: str
    email: str | None
    phone: str | None
    total_experience_years: float
    required_experience_years: float
    experience_comparison: str
    skills: list[str]
    experience: list[dict[str, Any]]
    education: list[dict[str, Any]]
    projects: list[str]
    parse_status: str
    overall_score: float
    skill_score: float
    semantic_score: float
    experience_score: float
    education_score: float
    matched_skills: list[dict[str, Any]]
    missing_skills: list[dict[str, Any]]
    explanation: str
    weights: WeightConfig
    bias_note: str = "Automated scoring evaluates skills, semantic alignment, experience duration, and education only. Candidate name, email, gender, and photos are excluded from scoring."
