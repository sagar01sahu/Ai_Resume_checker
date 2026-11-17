from datetime import datetime, timezone
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .db import Base

JSONVariant = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobDescription(Base):
    __tablename__ = "job_descriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed: Mapped[dict] = mapped_column(JSONVariant, nullable=False, default=dict)
    status_state: Mapped[dict] = mapped_column(JSONVariant, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    candidates: Mapped[list["Candidate"]] = relationship(
        "Candidate", back_populates="job", cascade="all, delete-orphan"
    )
    match_results: Mapped[list["MatchResult"]] = relationship(
        "MatchResult", back_populates="job", cascade="all, delete-orphan"
    )


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("job_descriptions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Unknown Candidate")
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    total_experience_years: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    skills: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)
    experience: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)
    education: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)
    projects: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    parse_status: Mapped[str] = mapped_column(String(128), nullable=False, default="Parsed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["JobDescription"] = relationship("JobDescription", back_populates="candidates")
    match_result: Mapped["MatchResult | None"] = relationship(
        "MatchResult", back_populates="candidate", uselist=False, cascade="all, delete-orphan"
    )


class MatchResult(Base):
    __tablename__ = "match_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    candidate_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("job_descriptions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    overall_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    skill_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    semantic_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    experience_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    education_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    matched_skills: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)
    missing_skills: Mapped[list] = mapped_column(JSONVariant, nullable=False, default=list)
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    candidate: Mapped["Candidate"] = relationship("Candidate", back_populates="match_result")
    job: Mapped["JobDescription"] = relationship("JobDescription", back_populates="match_results")
