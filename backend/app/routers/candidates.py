from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..models import Candidate, JobDescription, MatchResult
from ..schemas import CandidateDetailResponse, WeightConfig

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


@router.get("/{candidate_id}", response_model=CandidateDetailResponse)
def get_candidate_detail(candidate_id: int, db: Session = Depends(get_db)):
    cand = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    job = db.query(JobDescription).filter(JobDescription.id == cand.job_id).first()
    mr = db.query(MatchResult).filter(MatchResult.candidate_id == cand.id).first()
    if not mr or not job:
        raise HTTPException(status_code=404, detail="Match result not computed for candidate")

    all_results = (
        db.query(MatchResult)
        .filter(MatchResult.job_id == job.id)
        .order_by(MatchResult.overall_score.desc(), MatchResult.candidate_id.asc())
        .all()
    )
    rank = 1
    for idx, r in enumerate(all_results):
        if r.candidate_id == cand.id:
            rank = idx + 1
            break

    req_years = float(job.parsed.get("min_years") or 0.0)
    if req_years <= 0 or cand.total_experience_years == req_years:
        exp_comp = "Meets"
    elif cand.total_experience_years > req_years:
        exp_comp = "Exceeds"
    else:
        exp_comp = "Below"

    return CandidateDetailResponse(
        candidate_id=cand.id,
        job_id=job.id,
        job_title=job.title,
        rank=rank,
        total_ranked=len(all_results),
        filename=cand.filename,
        name=cand.name,
        email=cand.email,
        phone=cand.phone,
        total_experience_years=cand.total_experience_years,
        required_experience_years=req_years,
        experience_comparison=exp_comp,
        skills=cand.skills,
        experience=cand.experience,
        education=cand.education,
        projects=cand.projects,
        parse_status=cand.parse_status,
        overall_score=mr.overall_score,
        skill_score=mr.skill_score,
        semantic_score=mr.semantic_score,
        experience_score=mr.experience_score,
        education_score=mr.education_score,
        matched_skills=mr.matched_skills,
        missing_skills=mr.missing_skills,
        explanation=mr.explanation,
        weights=WeightConfig(**settings.default_weights),
    )
