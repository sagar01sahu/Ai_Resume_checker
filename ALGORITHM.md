# ResumeRank Scoring Algorithm & Explainability

## 1. Hybrid Deterministic Formula

Each candidate is scored deterministically from `0` to `100`:

```
Final = w_skill * Skill + w_semantic * Semantic + w_exp * Experience + w_edu * Education
```

Default weights: `w_skill = 0.40`, `w_semantic = 0.25`, `w_exp = 0.25`, `w_edu = 0.10`.
The dashboard allows adjusting these weights in real time (always summing to `100%`) and compares each candidate's new rank against their default rank.

## 2. Sub-Score Components

1. **Skill Score (`40%`)**:
   - Skills are normalized through `skills_taxonomy.json` (e.g., `Postgres` -> `PostgreSQL`, `RESTful services` -> `REST APIs`, `GitHub Actions` -> `CI/CD`).
   - Each JD skill is compared against candidate skills using cosine similarity of `all-MiniLM-L6-v2` embeddings; matches above threshold (`>= 0.75`) or exact taxonomy matches count as matched.
   - Required (must-have) skills carry `2x` weight compared to nice-to-have skills (`1x`).
2. **Semantic Score (`25%`)**:
   - Resume text is segmented into section chunks (summary, experience, projects) and embedded alongside the full JD.
   - Mean of top-3 chunk-to-JD cosine similarities is rescaled from `[0.25, 0.78]` to `[0, 100]`.
3. **Experience Score (`25%`)**:
   - Work-history date ranges (excluding education dates) are merged as intervals so overlapping concurrent roles are never double-counted.
   - `Experience = min(candidate_years / required_years, 1.0) * 100` so over-qualification is not penalized.
4. **Education Score (`10%`)**:
   - Evaluates degree tier (`PhD > Master > Bachelor > Diploma`) and technical field alignment (`Computer Science / IT / ECE`) against the JD requirement.

## 3. Explainability & Bias Controls

- **Deterministic Explanations**: Every match generates an auditable rule-based summary first. When `GEMINI_API_KEY` is configured, Gemini narrates only the already-computed numbers and matched/missing skill evidence—the LLM never decides or modifies scores.
- **Bias-Awareness**: Automated scoring explicitly ignores candidate name, email, phone number, gender, and photos.
