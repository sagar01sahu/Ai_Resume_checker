import csv
import io
import os
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..db import SessionLocal, get_db
from ..models import Candidate, JobDescription, MatchResult
from ..schemas import (
    BatchUploadResponse,
    CandidateUploadItem,
    JobResponse,
    MatchRunRequest,
    ParsedJD,
    RankedCandidateItem,
    RankingResponse,
    WeightConfig,
)
from ..services.explainer import generate_explanation
from ..services.extractor import extract_candidate_profile, parse_job_description
from ..services.matcher import compute_overall_score, score_candidate
from ..services.parser import parse_document

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _job_to_response(job: JobDescription) -> JobResponse:
    parsed = ParsedJD(
        title=job.parsed.get("title") or job.title,
        required_skills=job.parsed.get("required_skills", []),
        preferred_skills=job.parsed.get("preferred_skills", []),
        min_years=float(job.parsed.get("min_years") or 0.0),
        education=job.parsed.get("education") or "",
        responsibilities=job.parsed.get("responsibilities", []),
    )
    parsed_count = sum(1 for c in job.candidates if c.parse_status == "Parsed")
    return JobResponse(
        id=job.id,
        title=job.title,
        raw_text=job.raw_text,
        parsed=parsed,
        created_at=job.created_at,
        candidate_count=len(job.candidates),
        parsed_count=parsed_count,
    )


@router.get("", response_model=list[JobResponse])
def list_jobs(db: Session = Depends(get_db)):
    jobs = db.query(JobDescription).order_by(JobDescription.created_at.desc()).all()
    return [_job_to_response(j) for j in jobs]


@router.post("", response_model=JobResponse)
async def create_job(
    request: Request,
    db: Session = Depends(get_db),
):
    content_type = request.headers.get("content-type", "")
    text = ""
    if "application/json" in content_type:
        body = await request.json()
        text = str(body.get("raw_text") or "").strip()
    else:
        form = await request.form()
        raw_val = form.get("raw_text")
        if isinstance(raw_val, str):
            text = raw_val.strip()
        up_file = form.get("file")
        if up_file is not None and hasattr(up_file, "read"):
            data = await up_file.read()
            parsed_doc = parse_document(getattr(up_file, "filename", None) or "jd.txt", data)
            if parsed_doc.status != "Parsed":
                raise HTTPException(status_code=400, detail=f"Could not parse JD file: {parsed_doc.status}")
            text = parsed_doc.text

    if not text:
        raise HTTPException(status_code=400, detail="Job description text or file is required.")

    parsed = parse_job_description(text)
    job = JobDescription(
        title=parsed["title"],
        raw_text=text,
        parsed=parsed,
        status_state={"phase": "idle", "cancelled": False},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_to_response(job)


@router.post("/{job_id}/resumes", response_model=BatchUploadResponse)
async def upload_resumes(
    job_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    items: list[CandidateUploadItem] = []
    parsed_count = 0
    failed_count = 0

    for uf in files:
        data = await uf.read()
        filename = uf.filename or "resume.pdf"
        res = parse_document(filename, data)
        if res.status == "Parsed":
            profile = extract_candidate_profile(res.text, filename)
            cand = Candidate(
                job_id=job.id,
                filename=filename,
                file_size_bytes=len(data),
                name=profile["name"],
                email=profile["email"],
                phone=profile["phone"],
                total_experience_years=profile["total_experience_years"],
                skills=profile["skills"],
                experience=profile["experience"],
                education=profile["education"],
                projects=profile["projects"],
                raw_text=res.text,
                parse_status="Parsed",
            )
            parsed_count += 1
        else:
            cand = Candidate(
                job_id=job.id,
                filename=filename,
                file_size_bytes=len(data),
                name=os.path.splitext(filename)[0],
                parse_status=res.status,
                raw_text="",
            )
            failed_count += 1

        db.add(cand)
        db.flush()
        items.append(
            CandidateUploadItem(
                id=cand.id,
                filename=cand.filename,
                file_size_bytes=cand.file_size_bytes,
                name=cand.name,
                parse_status=cand.parse_status,
            )
        )

    db.commit()
    return BatchUploadResponse(
        job_id=job.id,
        total_files=len(items),
        parsed_count=parsed_count,
        failed_count=failed_count,
        candidates=items,
    )


@router.post("/{job_id}/sample", response_model=BatchUploadResponse)
def load_sample_resumes(job_id: int, db: Session = Depends(get_db)):
    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    sample_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "sample_resumes")
    )
    if not os.path.isdir(sample_dir):
        raise HTTPException(status_code=404, detail="Sample resumes directory not found")

    db.query(Candidate).filter(Candidate.job_id == job.id).delete()
    db.flush()

    items: list[CandidateUploadItem] = []
    parsed_count = 0
    failed_count = 0

    for fname in sorted(os.listdir(sample_dir)):
        if fname.startswith("senior_backend_jd") or not (fname.endswith(".pdf") or fname.endswith(".docx")):
            continue
        fpath = os.path.join(sample_dir, fname)
        with open(fpath, "rb") as f:
            data = f.read()
        res = parse_document(fname, data)
        if res.status == "Parsed":
            profile = extract_candidate_profile(res.text, fname)
            cand = Candidate(
                job_id=job.id,
                filename=fname,
                file_size_bytes=len(data),
                name=profile["name"],
                email=profile["email"],
                phone=profile["phone"],
                total_experience_years=profile["total_experience_years"],
                skills=profile["skills"],
                experience=profile["experience"],
                education=profile["education"],
                projects=profile["projects"],
                raw_text=res.text,
                parse_status="Parsed",
            )
            parsed_count += 1
        else:
            cand = Candidate(
                job_id=job.id,
                filename=fname,
                file_size_bytes=len(data),
                name=os.path.splitext(fname)[0],
                parse_status=res.status,
                raw_text="",
            )
            failed_count += 1

        db.add(cand)
        db.flush()
        items.append(
            CandidateUploadItem(
                id=cand.id,
                filename=cand.filename,
                file_size_bytes=cand.file_size_bytes,
                name=cand.name,
                parse_status=cand.parse_status,
            )
        )

    db.commit()
    return BatchUploadResponse(
        job_id=job.id,
        total_files=len(items),
        parsed_count=parsed_count,
        failed_count=failed_count,
        candidates=items,
    )


@router.delete("/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"deleted": job_id}


def _run_matching_task(job_id: int, weights_dict: dict[str, float]) -> None:
    db = SessionLocal()
    try:
        job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
        if not job:
            return

        all_cands = list(job.candidates)
        total_files = len(all_cands)
        parsed_cands = [c for c in all_cands if c.parse_status == "Parsed"]
        skipped = [
            {"filename": c.filename, "reason": c.parse_status}
            for c in all_cands
            if c.parse_status != "Parsed"
        ]
        total_parsed = len(parsed_cands)

        state: dict[str, Any] = {
            "phase": "running",
            "cancelled": False,
            "total_files": total_files,
            "total_parsed": total_parsed,
            "skipped": skipped,
            "steps": {
                "reading": {"done": total_files, "total": total_files, "status": "done"},
                "extracting": {"done": total_parsed, "total": total_files, "status": "done"},
                "embedding": {"done": 0, "total": total_parsed, "status": "running"},
                "explaining": {"done": 0, "total": total_parsed, "status": "waiting"},
            },
        }
        job.status_state = state
        db.commit()

        computed: list[tuple[Candidate, dict[str, Any]]] = []
        for idx, cand in enumerate(parsed_cands):
            db.refresh(job)
            if job.status_state.get("cancelled"):
                job.status_state = {**job.status_state, "phase": "cancelled"}
                db.commit()
                return

            scores = score_candidate(
                job.raw_text,
                job.parsed,
                {
                    "skills": cand.skills,
                    "total_experience_years": cand.total_experience_years,
                    "education": cand.education,
                    "raw_text": cand.raw_text,
                },
                weights=weights_dict,
            )
            computed.append((cand, scores))
            state["steps"]["embedding"] = {
                "done": idx + 1,
                "total": total_parsed,
                "status": "done" if idx + 1 == total_parsed else "running",
            }
            job.status_state = dict(state)
            db.commit()

        state["steps"]["explaining"]["status"] = "running"
        job.status_state = dict(state)
        db.commit()

        for idx, (cand, scores) in enumerate(computed):
            db.refresh(job)
            if job.status_state.get("cancelled"):
                job.status_state = {**job.status_state, "phase": "cancelled"}
                db.commit()
                return

            explanation = generate_explanation(
                job.parsed,
                {"total_experience_years": cand.total_experience_years},
                scores,
            )

            existing = (
                db.query(MatchResult).filter(MatchResult.candidate_id == cand.id).first()
            )
            if existing:
                existing.overall_score = scores["overall_score"]
                existing.skill_score = scores["skill_score"]
                existing.semantic_score = scores["semantic_score"]
                existing.experience_score = scores["experience_score"]
                existing.education_score = scores["education_score"]
                existing.matched_skills = scores["matched_skills"]
                existing.missing_skills = scores["missing_skills"]
                existing.explanation = explanation
            else:
                db.add(
                    MatchResult(
                        candidate_id=cand.id,
                        job_id=job.id,
                        overall_score=scores["overall_score"],
                        skill_score=scores["skill_score"],
                        semantic_score=scores["semantic_score"],
                        experience_score=scores["experience_score"],
                        education_score=scores["education_score"],
                        matched_skills=scores["matched_skills"],
                        missing_skills=scores["missing_skills"],
                        explanation=explanation,
                    )
                )

            state["steps"]["explaining"] = {
                "done": idx + 1,
                "total": total_parsed,
                "status": "done" if idx + 1 == total_parsed else "running",
            }
            job.status_state = dict(state)
            db.commit()

        state["phase"] = "done"
        job.status_state = dict(state)
        db.commit()
    finally:
        db.close()


@router.post("/{job_id}/match")
def run_matching(
    job_id: int,
    background_tasks: BackgroundTasks,
    payload: MatchRunRequest | None = None,
    db: Session = Depends(get_db),
):
    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    weights = (payload.weights if payload and payload.weights else WeightConfig()).model_dump()
    job.status_state = {
        "phase": "running",
        "cancelled": False,
        "total_files": len(job.candidates),
        "total_parsed": sum(1 for c in job.candidates if c.parse_status == "Parsed"),
        "skipped": [
            {"filename": c.filename, "reason": c.parse_status}
            for c in job.candidates
            if c.parse_status != "Parsed"
        ],
        "steps": {
            "reading": {"done": len(job.candidates), "total": len(job.candidates), "status": "done"},
            "extracting": {"done": sum(1 for c in job.candidates if c.parse_status == "Parsed"), "total": len(job.candidates), "status": "done"},
            "embedding": {"done": 0, "total": sum(1 for c in job.candidates if c.parse_status == "Parsed"), "status": "running"},
            "explaining": {"done": 0, "total": sum(1 for c in job.candidates if c.parse_status == "Parsed"), "status": "waiting"},
        },
    }
    db.commit()
    background_tasks.add_task(_run_matching_task, job_id, weights)
    return {"job_id": job_id, "status": "running"}


@router.get("/{job_id}/status")
def get_match_status(job_id: int, db: Session = Depends(get_db)):
    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.status_state or {"phase": "idle"}


@router.post("/{job_id}/cancel")
def cancel_matching(job_id: int, db: Session = Depends(get_db)):
    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    state = dict(job.status_state or {})
    state["cancelled"] = True
    state["phase"] = "cancelled"
    job.status_state = state
    db.commit()
    return {"job_id": job_id, "status": "cancelled"}


@router.get("/{job_id}/ranking", response_model=RankingResponse)
def get_ranking(
    job_id: int,
    min_score: float = Query(default=0.0, ge=0.0, le=100.0),
    skills_w: float = Query(default=0.40, ge=0.0, le=1.0),
    semantic_w: float = Query(default=0.25, ge=0.0, le=1.0),
    experience_w: float = Query(default=0.25, ge=0.0, le=1.0),
    education_w: float = Query(default=0.10, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
):
    job = db.query(JobDescription).filter(JobDescription.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    weights_dict = {
        "skills": skills_w,
        "semantic": semantic_w,
        "experience": experience_w,
        "education": education_w,
    }
    results = (
        db.query(MatchResult, Candidate)
        .join(Candidate, MatchResult.candidate_id == Candidate.id)
        .filter(MatchResult.job_id == job_id)
        .all()
    )

    default_scored = []
    custom_scored = []
    for mr, cand in results:
        default_val = compute_overall_score(
            mr.skill_score, mr.semantic_score, mr.experience_score, mr.education_score, settings.default_weights
        )
        custom_val = compute_overall_score(
            mr.skill_score, mr.semantic_score, mr.experience_score, mr.education_score, weights_dict
        )
        default_scored.append((cand.id, default_val))
        custom_scored.append((cand, mr, custom_val))

    default_scored.sort(key=lambda x: (-x[1], x[0]))
    default_rank_map = {cid: idx + 1 for idx, (cid, _) in enumerate(default_scored)}

    custom_scored.sort(key=lambda x: (-x[2], x[0].id))

    ranked_items: list[RankedCandidateItem] = []
    for idx, (cand, mr, custom_val) in enumerate(custom_scored):
        rank = idx + 1
        if custom_val < min_score:
            continue
        def_rank = default_rank_map.get(cand.id, rank)
        edu_summary = cand.education[0]["degree"] if cand.education else ""
        must_missing = sum(1 for m in mr.missing_skills if m.get("type") == "required")
        ranked_items.append(
            RankedCandidateItem(
                rank=rank,
                default_rank=def_rank,
                rank_delta=def_rank - rank,
                candidate_id=cand.id,
                name=cand.name,
                email=cand.email,
                filename=cand.filename,
                experience_years=cand.total_experience_years,
                education_summary=edu_summary,
                overall_score=custom_val,
                skill_score=mr.skill_score,
                semantic_score=mr.semantic_score,
                experience_score=mr.experience_score,
                education_score=mr.education_score,
                matched_skills=mr.matched_skills,
                missing_skills=mr.missing_skills,
                must_have_missing_count=must_missing,
            )
        )

    failed_files = [
        {"filename": c.filename, "reason": c.parse_status}
        for c in job.candidates
        if c.parse_status != "Parsed"
    ]

    return RankingResponse(
        job=_job_to_response(job),
        total_candidates=len(job.candidates),
        ranked_count=len(custom_scored),
        failed_files=failed_files,
        weights=WeightConfig(**weights_dict),
        candidates=ranked_items,
    )


@router.get("/{job_id}/export")
def export_ranking_csv(job_id: int, min_score: float = 0.0, db: Session = Depends(get_db)):
    ranking = get_ranking(job_id=job_id, min_score=min_score, db=db)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Rank",
            "Candidate",
            "Email",
            "Experience (yrs)",
            "Overall Match %",
            "Skills Score",
            "Semantic Score",
            "Experience Score",
            "Education Score",
            "Matched Skills",
            "Missing Skills",
        ]
    )
    for item in ranking.candidates:
        writer.writerow(
            [
                item.rank,
                item.name,
                item.email or "",
                item.experience_years,
                item.overall_score,
                item.skill_score,
                item.semantic_score,
                item.experience_score,
                item.education_score,
                ", ".join(m["skill"] for m in item.matched_skills),
                ", ".join(m["skill"] for m in item.missing_skills),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="resumerank_job_{job_id}.csv"'},
    )
