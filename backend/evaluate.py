"""Evaluation script verifying ranking sanity across the 12 synthetic resumes."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from app.services.explainer import build_rule_based_explanation
from app.services.extractor import extract_candidate_profile, parse_job_description
from app.services.matcher import score_candidate
from app.services.parser import parse_document

SAMPLE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sample_resumes"))


def main() -> None:
    with open(os.path.join(SAMPLE_DIR, "senior_backend_jd.txt"), encoding="utf-8") as f:
        jd_raw = f.read()

    jd_parsed = parse_job_description(jd_raw)
    print(f"JD Parsed: {jd_parsed['title']} | Required: {jd_parsed['required_skills']} | Nice: {jd_parsed['preferred_skills']}")

    rows = []
    for fname in sorted(os.listdir(SAMPLE_DIR)):
        if fname.startswith("senior_backend_jd"):
            continue
        with open(os.path.join(SAMPLE_DIR, fname), "rb") as f:
            res = parse_document(fname, f.read())
        if res.status != "Parsed":
            print(f"  [SKIPPED] {fname} -> {res.status}")
            continue
        profile = extract_candidate_profile(res.text, fname)
        profile["raw_text"] = res.text
        scores = score_candidate(jd_raw, jd_parsed, profile)
        expl = build_rule_based_explanation(jd_parsed, profile, scores)
        rows.append((scores["overall_score"], profile["name"], profile["total_experience_years"], scores, expl))

    rows.sort(key=lambda x: -x[0])
    print("\nRanked Output:")
    for idx, (score, name, yrs, sc, expl) in enumerate(rows, 1):
        print(f"  #{idx:02d} {name:<18} {yrs:>4.1f} yrs | Overall {score:>5.1f}% (Skill {sc['skill_score']}, Sem {sc['semantic_score']}, Exp {sc['experience_score']}, Edu {sc['education_score']})")
        print(f"      -> {expl}")


if __name__ == "__main__":
    main()
