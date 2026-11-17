from app.services.extractor import (
    compute_deduped_experience_years,
    extract_skills_with_spacy,
    parse_job_description,
)
from app.services.matcher import (
    compute_experience_score,
    compute_overall_score,
    score_candidate,
)


def test_skill_alias_normalization():
    skills = extract_skills_with_spacy(
        "Built RESTful services using Python3, Postgres, and GitHub Actions."
    )
    assert "Python" in skills
    assert "PostgreSQL" in skills
    assert "REST APIs" in skills
    assert "CI/CD" in skills


def test_overlapping_experience_deduped():
    text = """
    Work Experience:
    Backend Developer, Alpha Corp (Jan 2022 - Dec 2024)
    Consultant, Beta Labs (Jan 2023 - Dec 2024)
    """
    years, _ = compute_deduped_experience_years(text)
    assert 2.8 <= years <= 3.1


def test_experience_overqualification_not_penalized():
    score, label = compute_experience_score(6.0, 4.0)
    assert score == 100.0
    assert label == "Exceeds"


def test_strong_vs_weak_candidate_ordering():
    jd_raw = (
        "Senior Backend Developer. We need 4+ years building REST APIs with Python and "
        "FastAPI, PostgreSQL, Docker and CI/CD. React is a plus. B.Tech in Computer Science."
    )
    jd_parsed = parse_job_description(jd_raw)

    strong = score_candidate(
        jd_raw,
        jd_parsed,
        {
            "skills": ["Python", "FastAPI", "PostgreSQL", "REST APIs", "Docker", "React"],
            "total_experience_years": 5.0,
            "education": [{"degree": "B.Tech", "details": "B.Tech Computer Science"}],
            "raw_text": "Senior Backend Engineer building FastAPI REST APIs with PostgreSQL and Docker containers.",
        },
    )
    weak = score_candidate(
        jd_raw,
        jd_parsed,
        {
            "skills": ["HTML", "CSS"],
            "total_experience_years": 1.0,
            "education": [{"degree": "BCA", "details": "BCA"}],
            "raw_text": "Junior web designer creating static HTML and CSS pages.",
        },
    )
    assert strong["overall_score"] > weak["overall_score"]
    assert compute_overall_score(95, 88, 100, 80) == 93.0
