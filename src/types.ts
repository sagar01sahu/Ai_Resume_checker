export interface ParsedJD {
  title: string;
  required_skills: string[];
  preferred_skills: string[];
  min_years: number;
  education: string;
  responsibilities: string[];
}

export interface JobSummary {
  id: number;
  title: string;
  raw_text: string;
  parsed: ParsedJD;
  created_at: string;
  candidate_count: number;
  parsed_count: number;
}

export interface CandidateUploadItem {
  id: number;
  filename: string;
  file_size_bytes: number;
  name: string;
  parse_status: string;
}

export interface BatchUploadResponse {
  job_id: number;
  total_files: number;
  parsed_count: number;
  failed_count: number;
  candidates: CandidateUploadItem[];
}

export interface WeightConfig {
  skills: number;
  semantic: number;
  experience: number;
  education: number;
}

export interface MatchedSkillItem {
  skill: string;
  type: 'required' | 'nice_to_have';
  matched_with?: string;
  similarity: number;
}

export interface RankedCandidateItem {
  rank: number;
  default_rank: number;
  rank_delta: number;
  candidate_id: number;
  name: string;
  email: string | null;
  filename: string;
  experience_years: number;
  education_summary: string;
  overall_score: number;
  skill_score: number;
  semantic_score: number;
  experience_score: number;
  education_score: number;
  matched_skills: MatchedSkillItem[];
  missing_skills: MatchedSkillItem[];
  must_have_missing_count: number;
}

export interface RankingResponse {
  job: JobSummary;
  total_candidates: number;
  ranked_count: number;
  failed_files: Array<{ filename: string; reason: string }>;
  weights: WeightConfig;
  candidates: RankedCandidateItem[];
}

export interface CandidateDetail {
  candidate_id: number;
  job_id: number;
  job_title: string;
  rank: number;
  total_ranked: number;
  filename: string;
  name: string;
  email: string | null;
  phone: string | null;
  total_experience_years: number;
  required_experience_years: number;
  experience_comparison: string;
  skills: string[];
  experience: Array<{ role: string; period: string; months: number }>;
  education: Array<{ degree: string; details: string }>;
  projects: string[];
  parse_status: string;
  overall_score: number;
  skill_score: number;
  semantic_score: number;
  experience_score: number;
  education_score: number;
  matched_skills: MatchedSkillItem[];
  missing_skills: MatchedSkillItem[];
  explanation: string;
  weights: WeightConfig;
  bias_note: string;
}

export interface MatchStepState {
  done: number;
  total: number;
  status: 'done' | 'running' | 'waiting';
}

export interface MatchStatusResponse {
  phase: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
  cancelled?: boolean;
  total_files?: number;
  total_parsed?: number;
  skipped?: Array<{ filename: string; reason: string }>;
  error?: string;
  steps?: {
    reading: MatchStepState;
    extracting: MatchStepState;
    embedding: MatchStepState;
    explaining: MatchStepState;
  };
}
