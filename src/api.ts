import type {
  BatchUploadResponse,
  CandidateDetail,
  JobSummary,
  MatchStatusResponse,
  RankingResponse,
  WeightConfig,
} from './types';

async function handleJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function listJobs(): Promise<JobSummary[]> {
  const res = await fetch('/api/jobs');
  return handleJson<JobSummary[]>(res);
}

export async function createJobFromText(rawText: string): Promise<JobSummary> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text: rawText }),
  });
  return handleJson<JobSummary>(res);
}

export async function createJobFromFile(file: File): Promise<JobSummary> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/jobs', {
    method: 'POST',
    body: form,
  });
  return handleJson<JobSummary>(res);
}

export async function uploadResumes(jobId: number, files: File[]): Promise<BatchUploadResponse> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
  }
  const res = await fetch(`/api/jobs/${jobId}/resumes`, {
    method: 'POST',
    body: form,
  });
  return handleJson<BatchUploadResponse>(res);
}

export async function loadSampleResumes(jobId: number): Promise<BatchUploadResponse> {
  const res = await fetch(`/api/jobs/${jobId}/sample`, { method: 'POST' });
  return handleJson<BatchUploadResponse>(res);
}

export async function startMatching(jobId: number, weights?: WeightConfig): Promise<{ job_id: number; status: string }> {
  const res = await fetch(`/api/jobs/${jobId}/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights }),
  });
  return handleJson(res);
}

export async function getMatchStatus(jobId: number): Promise<MatchStatusResponse> {
  const res = await fetch(`/api/jobs/${jobId}/status`);
  return handleJson<MatchStatusResponse>(res);
}

export async function cancelMatching(jobId: number): Promise<void> {
  await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function getRanking(
  jobId: number,
  minScore = 0,
  weights?: WeightConfig
): Promise<RankingResponse> {
  const params = new URLSearchParams({ min_score: String(minScore) });
  if (weights) {
    params.set('skills_w', String(weights.skills));
    params.set('semantic_w', String(weights.semantic));
    params.set('experience_w', String(weights.experience));
    params.set('education_w', String(weights.education));
  }
  const res = await fetch(`/api/jobs/${jobId}/ranking?${params.toString()}`);
  return handleJson<RankingResponse>(res);
}

export async function getCandidateDetail(candidateId: number): Promise<CandidateDetail> {
  const res = await fetch(`/api/candidates/${candidateId}`);
  return handleJson<CandidateDetail>(res);
}

export async function deleteJob(jobId: number): Promise<void> {
  await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
}

export function getExportCsvUrl(jobId: number, minScore = 0): string {
  return `/api/jobs/${jobId}/export?min_score=${encodeURIComponent(String(minScore))}`;
}
