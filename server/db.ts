import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'resumerank.sqlite');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS job_descriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    parsed TEXT NOT NULL DEFAULT '{}',
    status_state TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT 'Unknown Candidate',
    email TEXT,
    phone TEXT,
    total_experience_years REAL NOT NULL DEFAULT 0,
    skills TEXT NOT NULL DEFAULT '[]',
    experience TEXT NOT NULL DEFAULT '[]',
    education TEXT NOT NULL DEFAULT '[]',
    projects TEXT NOT NULL DEFAULT '[]',
    raw_text TEXT NOT NULL DEFAULT '',
    parse_status TEXT NOT NULL DEFAULT 'Parsed',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS match_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE,
    overall_score REAL NOT NULL DEFAULT 0,
    skill_score REAL NOT NULL DEFAULT 0,
    semantic_score REAL NOT NULL DEFAULT 0,
    experience_score REAL NOT NULL DEFAULT 0,
    education_score REAL NOT NULL DEFAULT 0,
    matched_skills TEXT NOT NULL DEFAULT '[]',
    missing_skills TEXT NOT NULL DEFAULT '[]',
    explanation TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface JobRow {
  id: number;
  title: string;
  raw_text: string;
  parsed: string;
  status_state: string;
  created_at: string;
}

export interface CandidateRow {
  id: number;
  job_id: number;
  filename: string;
  file_size_bytes: number;
  name: string;
  email: string | null;
  phone: string | null;
  total_experience_years: number;
  skills: string;
  experience: string;
  education: string;
  projects: string;
  raw_text: string;
  parse_status: string;
  created_at: string;
}

export interface MatchResultRow {
  id: number;
  candidate_id: number;
  job_id: number;
  overall_score: number;
  skill_score: number;
  semantic_score: number;
  experience_score: number;
  education_score: number;
  matched_skills: string;
  missing_skills: string;
  explanation: string;
  created_at: string;
}
