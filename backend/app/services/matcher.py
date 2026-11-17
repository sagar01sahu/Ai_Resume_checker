import re
from functools import lru_cache
from typing import Any

import numpy as np
from sentence_transformers import SentenceTransformer

from ..config import settings
from .extractor import normalize_skill

_EMBEDDING_CACHE: dict[str, np.ndarray] = {}


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    return SentenceTransformer(settings.embedding_model)


def embed_texts(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)

    missing = [t for t in texts if t not in _EMBEDDING_CACHE]
    if missing:
        model = get_embedding_model()
        vecs = model.encode(missing, normalize_embeddings=True, convert_to_numpy=True)
        for text, vec in zip(missing, vecs):
            _EMBEDDING_CACHE[text] = vec.astype(np.float32)

    return np.stack([_EMBEDDING_CACHE[t] for t in texts], axis=0)


def _cosine_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if a.size == 0 or b.size == 0:
        return np.zeros((a.shape[0], b.shape[0]), dtype=np.float32)
    return np.clip(a @ b.T, -1.0, 1.0)


def compute_skill_score(
    required_skills: list[str],
    preferred_skills: list[str],
    candidate_skills: list[str],
    threshold: float = settings.skill_match_threshold,
) -> tuple[float, list[dict[str, Any]], list[dict[str, Any]]]:
    if not required_skills and not preferred_skills:
        return 100.0, [], []

    cand_norm = {normalize_skill(s): s for s in candidate_skills}
    cand_list = list(cand_norm.keys())

    jd_items: list[tuple[str, str, float]] = []
    for s in required_skills:
        jd_items.append((normalize_skill(s), "required", 2.0))
    for s in preferred_skills:
        ns = normalize_skill(s)
        if ns not in {x[0] for x in jd_items}:
            jd_items.append((ns, "nice_to_have", 1.0))

    if not cand_list:
        missing = [
            {"skill": skill, "type": kind, "similarity": 0.0}
            for skill, kind, _ in jd_items
        ]
        return 0.0, [], missing

    jd_vecs = embed_texts([x[0] for x in jd_items])
    cand_vecs = embed_texts(cand_list)
    sim_mat = _cosine_matrix(jd_vecs, cand_vecs)

    matched: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    weighted_matched = 0.0
    weighted_total = sum(w for _, _, w in jd_items)

    for idx, (jd_skill, kind, weight) in enumerate(jd_items):
        exact = jd_skill in cand_norm
        best_j = int(np.argmax(sim_mat[idx]))
        best_sim = 1.0 if exact else float(sim_mat[idx, best_j])
        best_cand_skill = jd_skill if exact else cand_list[best_j]

        if exact or best_sim >= threshold:
            weighted_matched += weight
            matched.append(
                {
                    "skill": jd_skill,
                    "type": kind,
                    "matched_with": best_cand_skill,
                    "similarity": round(best_sim, 3),
                }
            )
        else:
            missing.append(
                {
                    "skill": jd_skill,
                    "type": kind,
                    "similarity": round(best_sim, 3),
                }
            )

    score = (weighted_matched / weighted_total) * 100.0 if weighted_total > 0 else 100.0
    return round(score, 1), matched, missing


def _chunk_resume_text(raw_text: str) -> list[str]:
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw_text) if len(p.strip()) > 30]
    if paragraphs:
        return paragraphs[:8]
    lines = [ln.strip() for ln in raw_text.splitlines() if len(ln.strip()) > 20]
    chunks: list[str] = []
    for i in range(0, len(lines), 4):
        chunks.append(" ".join(lines[i : i + 4]))
    return chunks[:8] if chunks else [raw_text[:1000]]


def compute_semantic_score(jd_text: str, resume_text: str) -> float:
    if not jd_text.strip() or not resume_text.strip():
        return 0.0
    chunks = _chunk_resume_text(resume_text)
    jd_vec = embed_texts([jd_text[:2500]])
    chunk_vecs = embed_texts(chunks)
    sims = _cosine_matrix(chunk_vecs, jd_vec).flatten()
    top_k = np.sort(sims)[-min(3, len(sims)) :]
    mean_sim = float(np.mean(top_k))
    # Rescale 0.30-0.80 cosine range to 0-100 as specified in Requirement Analysis §4
    rescaled = ((mean_sim - 0.25) / (0.78 - 0.25)) * 100.0
    return round(float(np.clip(rescaled, 0.0, 100.0)), 1)


def compute_experience_score(candidate_years: float, required_years: float) -> tuple[float, str]:
    if required_years <= 0:
        return 100.0, "Meets"
    ratio = min(candidate_years / required_years, 1.0)
    score = round(ratio * 100.0, 1)
    if candidate_years > required_years:
        label = "Exceeds"
    elif candidate_years >= required_years:
        label = "Meets"
    else:
        label = "Below"
    return score, label


def _degree_rank(text: str) -> int:
    t = text.lower()
    if re.search(r"\b(ph\.?d|doctorate)\b", t):
        return 4
    if re.search(r"\b(m\.tech|m\.s\.?|m\.sc|mca|mba|master)\b", t):
        return 3
    if re.search(r"\b(b\.tech|b\.e\.?|b\.sc|bca|bachelor)\b", t):
        return 2
    if re.search(r"\b(diploma|associate)\b", t):
        return 1
    return 0


def _is_cs_field(text: str) -> bool:
    return bool(
        re.search(
            r"\b(computer science|cse|cs|software|information technology|it|electronics|ece|data science|computing)\b",
            text,
            re.I,
        )
    )


def compute_education_score(jd_education: str, candidate_education: list[dict[str, Any]], raw_text: str) -> float:
    edu_text = " ".join(e.get("details", "") for e in candidate_education) or raw_text
    cand_rank = _degree_rank(edu_text)
    req_rank = _degree_rank(jd_education) if jd_education else 2

    if req_rank == 0:
        return 80.0 if cand_rank >= 2 else 60.0

    if cand_rank == 0:
        return 30.0

    if cand_rank >= req_rank:
        base = 80.0 if cand_rank == req_rank else 95.0
    else:
        base = 50.0

    jd_cs = _is_cs_field(jd_education)
    cand_cs = _is_cs_field(edu_text)
    if jd_cs and cand_cs:
        base = min(100.0, base + 10.0)
    elif jd_cs and not cand_cs:
        base = max(40.0, base - 15.0)
    return round(base, 1)


def compute_overall_score(
    skill_score: float,
    semantic_score: float,
    experience_score: float,
    education_score: float,
    weights: dict[str, float] | None = None,
) -> float:
    w = weights or settings.default_weights
    total_w = w.get("skills", 0.4) + w.get("semantic", 0.25) + w.get("experience", 0.25) + w.get("education", 0.1)
    if total_w <= 0:
        total_w = 1.0
    val = (
        (w.get("skills", 0.4) / total_w) * skill_score
        + (w.get("semantic", 0.25) / total_w) * semantic_score
        + (w.get("experience", 0.25) / total_w) * experience_score
        + (w.get("education", 0.1) / total_w) * education_score
    )
    return round(val, 1)


def score_candidate(jd_raw: str, jd_parsed: dict[str, Any], candidate_data: dict[str, Any], weights: dict[str, float] | None = None) -> dict[str, Any]:
    skill_score, matched_skills, missing_skills = compute_skill_score(
        jd_parsed.get("required_skills", []),
        jd_parsed.get("preferred_skills", []),
        candidate_data.get("skills", []),
    )
    semantic_score = compute_semantic_score(jd_raw, candidate_data.get("raw_text", ""))
    experience_score, exp_label = compute_experience_score(
        float(candidate_data.get("total_experience_years", 0.0)),
        float(jd_parsed.get("min_years", 0.0)),
    )
    education_score = compute_education_score(
        jd_parsed.get("education", ""),
        candidate_data.get("education", []),
        candidate_data.get("raw_text", ""),
    )
    overall_score = compute_overall_score(
        skill_score, semantic_score, experience_score, education_score, weights
    )
    return {
        "overall_score": overall_score,
        "skill_score": skill_score,
        "semantic_score": semantic_score,
        "experience_score": experience_score,
        "education_score": education_score,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "experience_comparison": exp_label,
    }
