from typing import Any

from ..config import settings

try:
    from google import genai
except Exception:
    genai = None


def build_rule_based_explanation(
    jd_parsed: dict[str, Any],
    candidate: dict[str, Any],
    scores: dict[str, Any],
) -> str:
    req_skills = jd_parsed.get("required_skills", [])
    matched = scores.get("matched_skills", [])
    missing = scores.get("missing_skills", [])

    matched_req = [m["skill"] for m in matched if m.get("type") == "required"]
    matched_nice = [m["skill"] for m in matched if m.get("type") == "nice_to_have"]
    missing_names = [m["skill"] for m in missing]

    parts: list[str] = []
    if req_skills:
        skill_phrase = f"Matched {len(matched_req)} of {len(req_skills)} required skills"
        if matched_nice:
            skill_phrase += f" and the nice-to-have {', '.join(matched_nice)}"
        if missing_names:
            skill_phrase += f"; {', '.join(missing_names)} not mentioned"
        parts.append(skill_phrase + ".")
    elif matched:
        parts.append(f"Matched {', '.join(m['skill'] for m in matched)}.")

    req_yrs = float(jd_parsed.get("min_years") or 0)
    cand_yrs = float(candidate.get("total_experience_years") or 0)
    if req_yrs > 0:
        parts.append(
            f"{cand_yrs:g} years of relevant experience against {req_yrs:g} required ({round(scores['experience_score'])}%)."
        )
    else:
        parts.append(f"{cand_yrs:g} years of documented industry experience.")

    sem = float(scores.get("semantic_score", 0))
    if sem >= 75:
        parts.append("Resume work history and projects show strong semantic similarity to the role responsibilities.")
    elif sem >= 50:
        parts.append("Work history shows moderate semantic alignment with the core role responsibilities.")
    else:
        parts.append("Limited semantic overlap between resume projects and the target backend responsibilities.")

    edu_score = float(scores.get("education_score", 0))
    if edu_score >= 80:
        parts.append("Education meets or exceeds the stated degree requirement.")
    elif edu_score >= 50:
        parts.append("Education partially aligns with the stated degree requirement.")
    else:
        parts.append("Stated degree requirement is not clearly evidenced.")

    return " ".join(parts)


def generate_explanation(
    jd_parsed: dict[str, Any],
    candidate: dict[str, Any],
    scores: dict[str, Any],
) -> str:
    fallback = build_rule_based_explanation(jd_parsed, candidate, scores)
    if not settings.gemini_api_key or settings.llm_provider.lower() != "gemini" or genai is None:
        return fallback

    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        prompt = (
            "Write a concise 3-4 sentence recruiter-friendly explanation for a candidate match score. "
            "IMPORTANT: Only narrate the exact numbers and facts provided below. Do NOT invent skills, years, or change any score.\n\n"
            f"Role: {jd_parsed.get('title', 'Role')}\n"
            f"Overall score: {scores['overall_score']}%\n"
            f"Skills score: {scores['skill_score']}/100 | Matched: {[m['skill'] for m in scores['matched_skills']]} | Missing: {[m['skill'] for m in scores['missing_skills']]}\n"
            f"Experience: {candidate.get('total_experience_years', 0)} years vs {jd_parsed.get('min_years', 0)} required (score {scores['experience_score']}/100)\n"
            f"Semantic alignment score: {scores['semantic_score']}/100\n"
            f"Education score: {scores['education_score']}/100\n"
        )
        resp = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
        )
        text = (resp.text or "").strip()
        return text if text else fallback
    except Exception:
        return fallback
