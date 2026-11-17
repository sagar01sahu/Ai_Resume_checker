import json
import os
import re
from datetime import datetime
from functools import lru_cache
from typing import Any

import spacy
from spacy.matcher import PhraseMatcher

from ..config import settings

try:
    from google import genai
    from google.genai import types as genai_types
except Exception:
    genai = None
    genai_types = None

DATA_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "skills_taxonomy.json")

MONTH_MAP = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


@lru_cache(maxsize=1)
def load_taxonomy() -> list[dict[str, Any]]:
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)["skills"]


@lru_cache(maxsize=1)
def get_nlp():
    try:
        nlp = spacy.load("en_core_web_md")
    except OSError:
        nlp = spacy.blank("en")
    matcher = PhraseMatcher(nlp.vocab, attr="LOWER")
    alias_to_canonical: dict[str, str] = {}
    for entry in load_taxonomy():
        canonical = entry["canonical"]
        patterns = []
        for alias in [canonical, *entry.get("aliases", [])]:
            alias_to_canonical[alias.lower()] = canonical
            patterns.append(nlp.make_doc(alias))
        matcher.add(canonical, patterns)
    return nlp, matcher, alias_to_canonical


def extract_skills_with_spacy(text: str) -> list[str]:
    nlp, matcher, _ = get_nlp()
    doc = nlp(text)
    found: list[str] = []
    seen: set[str] = set()
    for match_id, _start, _end in matcher(doc):
        canonical = nlp.vocab.strings[match_id]
        if canonical not in seen:
            seen.add(canonical)
            found.append(canonical)
    return found


def normalize_skill(skill: str) -> str:
    _, _, alias_to_canonical = get_nlp()
    return alias_to_canonical.get(skill.strip().lower(), skill.strip())


def _parse_month_year(month_str: str | None, year_str: str) -> int:
    year = int(year_str)
    month = MONTH_MAP.get((month_str or "").lower(), 6)
    return year * 12 + (month - 1)


def compute_deduped_experience_years(text: str) -> tuple[float, list[dict[str, Any]]]:
    now = datetime.now()
    current_ym = now.year * 12 + (now.month - 1)

    date_range_pattern = re.compile(
        r"(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?"
        r"(20\d{2}|19\d{2})\s*[-–—to]+\s*"
        r"(?:(Present|Current|Now)|"
        r"(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?"
        r"(20\d{2}|19\d{2}))",
        re.IGNORECASE,
    )

    intervals: list[tuple[int, int]] = []
    history: list[dict[str, Any]] = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    for ln in lines:
        # Skip education lines when calculating work experience
        if re.search(r"\b(B\.Tech|M\.Tech|B\.E\.|B\.Sc|M\.Sc|BCA|MCA|Bachelor|Master|University|College|Institute)\b", ln, re.I):
            continue
        for m in date_range_pattern.finditer(ln):
            start_ym = _parse_month_year(m.group(1), m.group(2))
            if m.group(3):
                end_ym = current_ym
                end_label = "Present"
            else:
                end_ym = _parse_month_year(m.group(4), m.group(5))
                end_label = f"{m.group(4) or ''} {m.group(5)}".strip()
            if end_ym >= start_ym and (end_ym - start_ym) <= 40 * 12:
                intervals.append((start_ym, max(start_ym + 1, end_ym)))
                role_line = re.sub(r"\(.*?\)", "", ln).strip(" -|")
                history.append({
                    "role": role_line[:120],
                    "period": f"{(m.group(1) or '')} {m.group(2)} - {end_label}".strip(),
                    "months": max(1, end_ym - start_ym),
                })

    if intervals:
        intervals.sort()
        merged: list[list[int]] = []
        for s, e in intervals:
            if not merged or s > merged[-1][1]:
                merged.append([s, e])
            else:
                merged[-1][1] = max(merged[-1][1], e)
        total_months = sum(e - s for s, e in merged)
        years = round(total_months / 12.0, 1)
        return years, history

    # Fallback: explicit "X+ years" mention in summary
    yrs_match = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b", text, re.I)
    if yrs_match:
        return float(yrs_match.group(1)), history
    return 0.0, history


def _extract_education(text: str) -> list[dict[str, Any]]:
    edu_entries: list[dict[str, Any]] = []
    deg_pattern = re.compile(
        r"\b(Ph\.?D|Doctorate|M\.Tech|M\.S\.?|M\.Sc|MCA|MBA|Master(?:'s)?|B\.Tech|B\.E\.?|B\.Sc|BCA|Bachelor(?:'s)?)\b"
        r"([^\n]{0,80})",
        re.IGNORECASE,
    )
    for ln in text.splitlines():
        m = deg_pattern.search(ln)
        if m:
            edu_entries.append({
                "degree": m.group(1).strip(),
                "details": ln.strip()[:140],
            })
    return edu_entries[:3]


def _extract_projects(text: str) -> list[str]:
    projects: list[str] = []
    in_projects = False
    for ln in text.splitlines():
        clean = ln.strip()
        if re.match(r"^projects?\s*:?$", clean, re.I):
            in_projects = True
            continue
        if in_projects:
            if re.match(r"^(education|work experience|experience|skills|certifications)\s*:?$", clean, re.I):
                break
            if clean:
                projects.append(clean.lstrip("-• "))
    return projects[:5]


def _extract_jd_with_gemini(raw_text: str) -> dict[str, Any] | None:
    if not settings.gemini_api_key or settings.llm_provider.lower() != "gemini" or genai is None:
        return None
    try:
        client = genai.Client(api_key=settings.gemini_api_key)
        prompt = (
            "Extract structured job requirements from the following job description. "
            "Return JSON with keys: title (string), required_skills (array of strings), "
            "preferred_skills (array of strings), min_years (number), education (string), "
            "responsibilities (array of strings).\n\n"
            f"Job Description:\n{raw_text[:6000]}"
        )
        resp = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        parsed = json.loads(resp.text or "{}")
        if isinstance(parsed, dict) and parsed.get("title"):
            parsed["required_skills"] = [normalize_skill(s) for s in parsed.get("required_skills", [])]
            parsed["preferred_skills"] = [normalize_skill(s) for s in parsed.get("preferred_skills", [])]
            return parsed
    except Exception:
        return None
    return None


def parse_job_description(raw_text: str) -> dict[str, Any]:
    gemini_result = _extract_jd_with_gemini(raw_text)
    if gemini_result:
        return {
            "title": gemini_result.get("title") or "Untitled Role",
            "required_skills": list(dict.fromkeys(gemini_result.get("required_skills", []))),
            "preferred_skills": list(dict.fromkeys(gemini_result.get("preferred_skills", []))),
            "min_years": float(gemini_result.get("min_years") or 0.0),
            "education": str(gemini_result.get("education") or ""),
            "responsibilities": gemini_result.get("responsibilities", [])[:6],
        }

    # Deterministic rule-based + spaCy extraction fallback
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    first_line = lines[0] if lines else "Untitled Role"
    title_match = re.match(r"^([A-Z][A-Za-z0-9\s/&+-]{2,60}?)(?:\.|,|$)", first_line)
    title = title_match.group(1).strip() if title_match else first_line[:60]

    # Split sentences to distinguish nice-to-have / preferred skills
    sentences = re.split(r"(?<=[.!?])\s+|\n+", raw_text)
    required_skills: list[str] = []
    preferred_skills: list[str] = []
    for sent in sentences:
        found = extract_skills_with_spacy(sent)
        if re.search(r"\b(plus|nice to have|preferred|bonus|desirable|optional)\b", sent, re.I):
            for s in found:
                if s not in preferred_skills and s not in required_skills:
                    preferred_skills.append(s)
        else:
            for s in found:
                if s not in required_skills:
                    required_skills.append(s)

    # Remove from preferred if already required
    preferred_skills = [s for s in preferred_skills if s not in required_skills]

    yrs_match = re.search(r"(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)", raw_text, re.I)
    min_years = float(yrs_match.group(1)) if yrs_match else 0.0

    edu_match = re.search(
        r"(B\.Tech|M\.Tech|B\.E\.?|B\.Sc|M\.Sc|Bachelor(?:'s)?|Master(?:'s)?|Ph\.?D)[^\n.]{0,60}",
        raw_text,
        re.I,
    )
    education = edu_match.group(0).strip() if edu_match else ""

    responsibilities = [
        ln.lstrip("-• ").strip()
        for ln in lines
        if ln.startswith("-") or ln.startswith("•")
    ][:6]

    return {
        "title": title,
        "required_skills": required_skills,
        "preferred_skills": preferred_skills,
        "min_years": min_years,
        "education": education,
        "responsibilities": responsibilities,
    }


def extract_candidate_profile(raw_text: str, filename: str) -> dict[str, Any]:
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    email_match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", raw_text)
    phone_match = re.search(r"(?:\+?\d[\d\s\-()]{8,16}\d)", raw_text)

    nlp, _, _ = get_nlp()
    doc = nlp(raw_text[:600])
    name = ""
    for ent in doc.ents:
        if ent.label_ == "PERSON" and len(ent.text.split()) >= 2:
            name = ent.text.strip()
            break
    if not name and lines:
        candidate_first = re.sub(r"[^A-Za-z\s.]", "", lines[0]).strip()
        if 2 <= len(candidate_first.split()) <= 4:
            name = candidate_first
    if not name:
        base = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
        name = " ".join(w.capitalize() for w in base.split())

    skills = extract_skills_with_spacy(raw_text)
    total_years, history = compute_deduped_experience_years(raw_text)
    education = _extract_education(raw_text)
    projects = _extract_projects(raw_text)

    return {
        "name": name,
        "email": email_match.group(0) if email_match else None,
        "phone": phone_match.group(0).strip() if phone_match else None,
        "skills": skills,
        "total_experience_years": total_years,
        "experience": history,
        "education": education,
        "projects": projects,
    }
