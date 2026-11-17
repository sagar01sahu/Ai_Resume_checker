import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, type CandidateRow, type JobRow, type MatchResultRow } from './server/db.ts';
import {
  computeOverallScore,
  DEFAULT_WEIGHTS,
  extractCandidateProfile,
  generateExplanation,
  parseJobDescription,
  scoreCandidate,
  type MatchedSkillItem,
  type ParsedJD,
  type WeightConfig,
} from './server/engine.ts';
import { parseDocument } from './server/parser.ts';

const PORT = Number(process.env.PORT) || 3000;
const SAMPLE_DIR = path.resolve(process.cwd(), 'sample_resumes');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 60 },
});

function formatJob(row: JobRow) {
  const cands = db
    .prepare('SELECT id, parse_status FROM candidates WHERE job_id = ?')
    .all(row.id) as Array<{ id: number; parse_status: string }>;
  const parsed = JSON.parse(row.parsed || '{}') as ParsedJD;
  const parsedCount = cands.filter((c) => c.parse_status === 'Parsed').length;
  return {
    id: row.id,
    title: row.title,
    raw_text: row.raw_text,
    parsed: {
      title: parsed.title || row.title,
      required_skills: parsed.required_skills || [],
      preferred_skills: parsed.preferred_skills || [],
      min_years: Number(parsed.min_years || 0),
      education: parsed.education || '',
      responsibilities: parsed.responsibilities || [],
    },
    created_at: row.created_at,
    candidate_count: cands.length,
    parsed_count: parsedCount,
  };
}

function updateJobStatus(jobId: number, state: Record<string, unknown>) {
  db.prepare('UPDATE job_descriptions SET status_state = ? WHERE id = ?').run(
    JSON.stringify(state),
    jobId
  );
}

async function runMatchingBackground(jobId: number, weights: WeightConfig) {
  const job = db.prepare('SELECT * FROM job_descriptions WHERE id = ?').get(jobId) as JobRow | undefined;
  if (!job) return;

  const jdParsed = JSON.parse(job.parsed || '{}') as ParsedJD;
  const allCands = db
    .prepare('SELECT * FROM candidates WHERE job_id = ? ORDER BY id ASC')
    .all(jobId) as unknown as CandidateRow[];

  const totalFiles = allCands.length;
  const parsedCands = allCands.filter((c) => c.parse_status === 'Parsed');
  const skipped = allCands
    .filter((c) => c.parse_status !== 'Parsed')
    .map((c) => ({ filename: c.filename, reason: c.parse_status }));

  const state: Record<string, any> = {
    phase: 'running',
    cancelled: false,
    total_files: totalFiles,
    total_parsed: parsedCands.length,
    skipped,
    steps: {
      reading: { done: totalFiles, total: totalFiles, status: 'done' },
      extracting: { done: parsedCands.length, total: totalFiles, status: 'done' },
      embedding: { done: 0, total: parsedCands.length, status: 'running' },
      explaining: { done: 0, total: parsedCands.length, status: 'waiting' },
    },
  };
  updateJobStatus(jobId, state);

  const computed: Array<{ cand: CandidateRow; scores: Awaited<ReturnType<typeof scoreCandidate>> }> = [];

  for (let i = 0; i < parsedCands.length; i++) {
    const latest = db.prepare('SELECT status_state FROM job_descriptions WHERE id = ?').get(jobId) as
      | { status_state: string }
      | undefined;
    const latestState = JSON.parse(latest?.status_state || '{}');
    if (latestState.cancelled) {
      updateJobStatus(jobId, { ...latestState, phase: 'cancelled' });
      return;
    }

    const cand = parsedCands[i];
    const scores = await scoreCandidate(
      job.raw_text,
      jdParsed,
      {
        skills: JSON.parse(cand.skills || '[]'),
        total_experience_years: cand.total_experience_years,
        education: JSON.parse(cand.education || '[]'),
        raw_text: cand.raw_text,
      },
      weights
    );
    computed.push({ cand, scores });

    state.steps.embedding = {
      done: i + 1,
      total: parsedCands.length,
      status: i + 1 === parsedCands.length ? 'done' : 'running',
    };
    updateJobStatus(jobId, state);
  }

  state.steps.explaining.status = 'running';
  updateJobStatus(jobId, state);

  const upsertMatch = db.prepare(`
    INSERT INTO match_results (
      candidate_id, job_id, overall_score, skill_score, semantic_score,
      experience_score, education_score, matched_skills, missing_skills, explanation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET
      overall_score = excluded.overall_score,
      skill_score = excluded.skill_score,
      semantic_score = excluded.semantic_score,
      experience_score = excluded.experience_score,
      education_score = excluded.education_score,
      matched_skills = excluded.matched_skills,
      missing_skills = excluded.missing_skills,
      explanation = excluded.explanation
  `);

  for (let i = 0; i < computed.length; i++) {
    const latest = db.prepare('SELECT status_state FROM job_descriptions WHERE id = ?').get(jobId) as
      | { status_state: string }
      | undefined;
    const latestState = JSON.parse(latest?.status_state || '{}');
    if (latestState.cancelled) {
      updateJobStatus(jobId, { ...latestState, phase: 'cancelled' });
      return;
    }

    const { cand, scores } = computed[i];
    const explanation = await generateExplanation(jdParsed, cand.total_experience_years, scores);

    upsertMatch.run(
      cand.id,
      jobId,
      scores.overall_score,
      scores.skill_score,
      scores.semantic_score,
      scores.experience_score,
      scores.education_score,
      JSON.stringify(scores.matched_skills),
      JSON.stringify(scores.missing_skills),
      explanation
    );

    state.steps.explaining = {
      done: i + 1,
      total: parsedCands.length,
      status: i + 1 === parsedCands.length ? 'done' : 'running',
    };
    updateJobStatus(jobId, state);
  }

  state.phase = 'done';
  updateJobStatus(jobId, state);
}

async function attachResumesToJob(
  jobId: number,
  files: Array<{ filename: string; buffer: Buffer }>
) {
  const insertCand = db.prepare(`
    INSERT INTO candidates (
      job_id, filename, file_size_bytes, name, email, phone,
      total_experience_years, skills, experience, education, projects, raw_text, parse_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const items: Array<{
    id: number;
    filename: string;
    file_size_bytes: number;
    name: string;
    parse_status: string;
  }> = [];
  let parsedCount = 0;
  let failedCount = 0;

  for (const f of files) {
    const res = await parseDocument(f.filename, f.buffer);
    if (res.status === 'Parsed') {
      const profile = extractCandidateProfile(res.text, f.filename);
      const info = insertCand.run(
        jobId,
        f.filename,
        f.buffer.length,
        profile.name,
        profile.email,
        profile.phone,
        profile.total_experience_years,
        JSON.stringify(profile.skills),
        JSON.stringify(profile.experience),
        JSON.stringify(profile.education),
        JSON.stringify(profile.projects),
        res.text,
        'Parsed'
      );
      parsedCount++;
      items.push({
        id: Number(info.lastInsertRowid),
        filename: f.filename,
        file_size_bytes: f.buffer.length,
        name: profile.name,
        parse_status: 'Parsed',
      });
    } else {
      const fallbackName = path.basename(f.filename, path.extname(f.filename));
      const info = insertCand.run(
        jobId,
        f.filename,
        f.buffer.length,
        fallbackName,
        null,
        null,
        0,
        '[]',
        '[]',
        '[]',
        '[]',
        '',
        res.status
      );
      failedCount++;
      items.push({
        id: Number(info.lastInsertRowid),
        filename: f.filename,
        file_size_bytes: f.buffer.length,
        name: fallbackName,
        parse_status: res.status,
      });
    }
  }

  return {
    job_id: jobId,
    total_files: items.length,
    parsed_count: parsedCount,
    failed_count: failedCount,
    candidates: items,
  };
}

function buildRankingResponse(
  jobId: number,
  minScore: number,
  weights: WeightConfig
) {
  const job = db.prepare('SELECT * FROM job_descriptions WHERE id = ?').get(jobId) as JobRow | undefined;
  if (!job) return null;

  const cands = db
    .prepare('SELECT * FROM candidates WHERE job_id = ? ORDER BY id ASC')
    .all(jobId) as unknown as CandidateRow[];
  const results = db
    .prepare('SELECT * FROM match_results WHERE job_id = ?')
    .all(jobId) as unknown as MatchResultRow[];

  const candById = new Map<number, CandidateRow>();
  for (const c of cands) candById.set(c.id, c);

  const defaultScored = results
    .map((mr) => ({
      candidate_id: mr.candidate_id,
      score: computeOverallScore(
        mr.skill_score,
        mr.semantic_score,
        mr.experience_score,
        mr.education_score,
        DEFAULT_WEIGHTS
      ),
    }))
    .sort((a, b) => b.score - a.score || a.candidate_id - b.candidate_id);

  const defaultRankMap = new Map<number, number>();
  defaultScored.forEach((item, idx) => defaultRankMap.set(item.candidate_id, idx + 1));

  const customScored = results
    .map((mr) => {
      const cand = candById.get(mr.candidate_id)!;
      const score = computeOverallScore(
        mr.skill_score,
        mr.semantic_score,
        mr.experience_score,
        mr.education_score,
        weights
      );
      return { mr, cand, score };
    })
    .filter((x) => Boolean(x.cand))
    .sort((a, b) => b.score - a.score || a.cand.id - b.cand.id);

  const rankedItems = customScored
    .map((entry, idx) => {
      const rank = idx + 1;
      const defRank = defaultRankMap.get(entry.cand.id) ?? rank;
      const eduList = JSON.parse(entry.cand.education || '[]') as Array<{ degree: string; details: string }>;
      const matchedSkills = JSON.parse(entry.mr.matched_skills || '[]') as MatchedSkillItem[];
      const missingSkills = JSON.parse(entry.mr.missing_skills || '[]') as MatchedSkillItem[];
      return {
        rank,
        default_rank: defRank,
        rank_delta: defRank - rank,
        candidate_id: entry.cand.id,
        name: entry.cand.name,
        email: entry.cand.email,
        filename: entry.cand.filename,
        experience_years: entry.cand.total_experience_years,
        education_summary: eduList[0]?.degree || '',
        overall_score: entry.score,
        skill_score: entry.mr.skill_score,
        semantic_score: entry.mr.semantic_score,
        experience_score: entry.mr.experience_score,
        education_score: entry.mr.education_score,
        matched_skills: matchedSkills,
        missing_skills: missingSkills,
        must_have_missing_count: missingSkills.filter((m) => m.type === 'required').length,
      };
    })
    .filter((item) => item.overall_score >= minScore);

  const failedFiles = cands
    .filter((c) => c.parse_status !== 'Parsed')
    .map((c) => ({ filename: c.filename, reason: c.parse_status }));

  return {
    job: formatJob(job),
    total_candidates: cands.length,
    ranked_count: customScored.length,
    failed_files: failedFiles,
    weights,
    candidates: rankedItems,
  };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    const hasGemini = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      status: 'ok',
      embedding_model: hasGemini ? 'gemini-embedding-2' : 'all-MiniLM-L6-v2 (fallback)',
      llm_provider: hasGemini ? 'gemini' : 'rule-based',
    });
  });

  app.get('/api/jobs', (_req, res) => {
    const rows = db
      .prepare('SELECT * FROM job_descriptions ORDER BY id DESC')
      .all() as unknown as JobRow[];
    res.json(rows.map(formatJob));
  });

  app.post('/api/jobs', upload.single('file'), async (req, res) => {
    try {
      let text = typeof req.body?.raw_text === 'string' ? req.body.raw_text.trim() : '';
      if (req.file) {
        const parsedFile = await parseDocument(req.file.originalname, req.file.buffer);
        if (parsedFile.status !== 'Parsed') {
          return res.status(400).json({ detail: `Could not parse JD file: ${parsedFile.status}` });
        }
        text = parsedFile.text;
      }

      if (!text) {
        return res.status(400).json({ detail: 'Job description text or file is required.' });
      }

      const parsed = await parseJobDescription(text);
      const info = db
        .prepare(
          'INSERT INTO job_descriptions (title, raw_text, parsed, status_state) VALUES (?, ?, ?, ?)'
        )
        .run(
          parsed.title,
          text,
          JSON.stringify(parsed),
          JSON.stringify({ phase: 'idle', cancelled: false })
        );
      const created = db
        .prepare('SELECT * FROM job_descriptions WHERE id = ?')
        .get(Number(info.lastInsertRowid)) as unknown as JobRow;
      res.json(formatJob(created));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create job';
      res.status(500).json({ detail: msg });
    }
  });

  app.post('/api/jobs/:id/resumes', upload.array('files', 60), async (req, res) => {
    const jobId = Number(req.params.id);
    const job = db.prepare('SELECT * FROM job_descriptions WHERE id = ?').get(jobId) as JobRow | undefined;
    if (!job) return res.status(404).json({ detail: 'Job not found' });

    const uploaded = (req.files as Express.Multer.File[] | undefined) || [];
    if (uploaded.length === 0) {
      return res.status(400).json({ detail: 'No resume files provided.' });
    }

    const payload = await attachResumesToJob(
      jobId,
      uploaded.map((f) => ({ filename: f.originalname, buffer: f.buffer }))
    );
    res.json(payload);
  });

  app.post('/api/jobs/:id/sample', async (req, res) => {
    const jobId = Number(req.params.id);
    const job = db.prepare('SELECT * FROM job_descriptions WHERE id = ?').get(jobId) as JobRow | undefined;
    if (!job) return res.status(404).json({ detail: 'Job not found' });

    if (!fs.existsSync(SAMPLE_DIR)) {
      return res.status(404).json({ detail: 'Sample resumes directory not found.' });
    }

    // Clear existing candidates for a clean demo batch on this job
    db.prepare('DELETE FROM candidates WHERE job_id = ?').run(jobId);

    const files = fs
      .readdirSync(SAMPLE_DIR)
      .filter((f) => !f.startsWith('senior_backend_jd') && (f.endsWith('.pdf') || f.endsWith('.docx')))
      .sort()
      .map((fname) => ({
        filename: fname,
        buffer: fs.readFileSync(path.join(SAMPLE_DIR, fname)),
      }));

    const payload = await attachResumesToJob(jobId, files);
    res.json(payload);
  });

  app.post('/api/jobs/:id/match', (req, res) => {
    const jobId = Number(req.params.id);
    const job = db.prepare('SELECT * FROM job_descriptions WHERE id = ?').get(jobId) as JobRow | undefined;
    if (!job) return res.status(404).json({ detail: 'Job not found' });

    const weights: WeightConfig = req.body?.weights || DEFAULT_WEIGHTS;
    const allCands = db
      .prepare('SELECT id, filename, parse_status FROM candidates WHERE job_id = ?')
      .all(jobId) as Array<{ id: number; filename: string; parse_status: string }>;
    const parsedCount = allCands.filter((c) => c.parse_status === 'Parsed').length;

    updateJobStatus(jobId, {
      phase: 'running',
      cancelled: false,
      total_files: allCands.length,
      total_parsed: parsedCount,
      skipped: allCands
        .filter((c) => c.parse_status !== 'Parsed')
        .map((c) => ({ filename: c.filename, reason: c.parse_status })),
      steps: {
        reading: { done: allCands.length, total: allCands.length, status: 'done' },
        extracting: { done: parsedCount, total: allCands.length, status: 'done' },
        embedding: { done: 0, total: parsedCount, status: 'running' },
        explaining: { done: 0, total: parsedCount, status: 'waiting' },
      },
    });

    setImmediate(() => {
      runMatchingBackground(jobId, weights).catch((err) => {
        console.error('Matching task failed:', err);
        updateJobStatus(jobId, { phase: 'error', error: String(err) });
      });
    });

    res.json({ job_id: jobId, status: 'running' });
  });

  app.get('/api/jobs/:id/status', (req, res) => {
    const jobId = Number(req.params.id);
    const job = db.prepare('SELECT status_state FROM job_descriptions WHERE id = ?').get(jobId) as
      | { status_state: string }
      | undefined;
    if (!job) return res.status(404).json({ detail: 'Job not found' });
    res.json(JSON.parse(job.status_state || '{"phase":"idle"}'));
  });

  app.post('/api/jobs/:id/cancel', (req, res) => {
    const jobId = Number(req.params.id);
    const job = db.prepare('SELECT status_state FROM job_descriptions WHERE id = ?').get(jobId) as
      | { status_state: string }
      | undefined;
    if (!job) return res.status(404).json({ detail: 'Job not found' });
    const state = JSON.parse(job.status_state || '{}');
    updateJobStatus(jobId, { ...state, cancelled: true, phase: 'cancelled' });
    res.json({ job_id: jobId, status: 'cancelled' });
  });

  app.get('/api/jobs/:id/ranking', (req, res) => {
    const jobId = Number(req.params.id);
    const minScore = Number(req.query.min_score ?? 0);
    const weights: WeightConfig = {
      skills: Number(req.query.skills_w ?? DEFAULT_WEIGHTS.skills),
      semantic: Number(req.query.semantic_w ?? DEFAULT_WEIGHTS.semantic),
      experience: Number(req.query.experience_w ?? DEFAULT_WEIGHTS.experience),
      education: Number(req.query.education_w ?? DEFAULT_WEIGHTS.education),
    };
    const ranking = buildRankingResponse(jobId, minScore, weights);
    if (!ranking) return res.status(404).json({ detail: 'Job not found' });
    res.json(ranking);
  });

  app.get('/api/jobs/:id/export', (req, res) => {
    const jobId = Number(req.params.id);
    const minScore = Number(req.query.min_score ?? 0);
    const ranking = buildRankingResponse(jobId, minScore, DEFAULT_WEIGHTS);
    if (!ranking) return res.status(404).json({ detail: 'Job not found' });

    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = [
      'Rank',
      'Candidate',
      'Email',
      'Experience (yrs)',
      'Overall Match %',
      'Skills Score',
      'Semantic Score',
      'Experience Score',
      'Education Score',
      'Matched Skills',
      'Missing Skills',
    ];
    const rows = ranking.candidates.map((c) => [
      c.rank,
      c.name,
      c.email || '',
      c.experience_years,
      c.overall_score,
      c.skill_score,
      c.semantic_score,
      c.experience_score,
      c.education_score,
      c.matched_skills.map((m) => m.skill).join(', '),
      c.missing_skills.map((m) => m.skill).join(', '),
    ]);
    const csv = [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="resumerank_job_${jobId}.csv"`);
    res.send(csv);
  });

  app.get('/api/candidates/:id', (req, res) => {
    const candidateId = Number(req.params.id);
    const cand = db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId) as
      | CandidateRow
      | undefined;
    if (!cand) return res.status(404).json({ detail: 'Candidate not found' });

    const job = db.prepare('SELECT * FROM job_descriptions WHERE id = ?').get(cand.job_id) as
      | JobRow
      | undefined;
    const mr = db.prepare('SELECT * FROM match_results WHERE candidate_id = ?').get(candidateId) as
      | MatchResultRow
      | undefined;
    if (!job || !mr) {
      return res.status(404).json({ detail: 'Match result not computed for candidate' });
    }

    const allResults = db
      .prepare(
        'SELECT candidate_id, overall_score FROM match_results WHERE job_id = ? ORDER BY overall_score DESC, candidate_id ASC'
      )
      .all(job.id) as Array<{ candidate_id: number; overall_score: number }>;
    const rank = allResults.findIndex((r) => r.candidate_id === cand.id) + 1 || 1;
    const jdParsed = JSON.parse(job.parsed || '{}') as ParsedJD;
    const reqYears = Number(jdParsed.min_years || 0);
    const expComp =
      reqYears <= 0 || cand.total_experience_years === reqYears
        ? 'Meets'
        : cand.total_experience_years > reqYears
          ? 'Exceeds'
          : 'Below';

    res.json({
      candidate_id: cand.id,
      job_id: job.id,
      job_title: job.title,
      rank,
      total_ranked: allResults.length,
      filename: cand.filename,
      name: cand.name,
      email: cand.email,
      phone: cand.phone,
      total_experience_years: cand.total_experience_years,
      required_experience_years: reqYears,
      experience_comparison: expComp,
      skills: JSON.parse(cand.skills || '[]'),
      experience: JSON.parse(cand.experience || '[]'),
      education: JSON.parse(cand.education || '[]'),
      projects: JSON.parse(cand.projects || '[]'),
      parse_status: cand.parse_status,
      overall_score: mr.overall_score,
      skill_score: mr.skill_score,
      semantic_score: mr.semantic_score,
      experience_score: mr.experience_score,
      education_score: mr.education_score,
      matched_skills: JSON.parse(mr.matched_skills || '[]'),
      missing_skills: JSON.parse(mr.missing_skills || '[]'),
      explanation: mr.explanation,
      weights: DEFAULT_WEIGHTS,
      bias_note:
        'Automated scoring evaluates skills, semantic alignment, experience duration, and education only. Candidate name, email, gender, and photos are excluded from scoring.',
    });
  });

  app.delete('/api/jobs/:id', (req, res) => {
    const jobId = Number(req.params.id);
    db.prepare('DELETE FROM job_descriptions WHERE id = ?').run(jobId);
    res.json({ deleted: jobId });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ResumeRank server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer();
