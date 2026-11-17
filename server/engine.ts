import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';

interface TaxonomyEntry {
  canonical: string;
  category: string;
  aliases: string[];
}

export interface ParsedJD {
  title: string;
  required_skills: string[];
  preferred_skills: string[];
  min_years: number;
  education: string;
  responsibilities: string[];
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

export interface ScoreOutput {
  overall_score: number;
  skill_score: number;
  semantic_score: number;
  experience_score: number;
  education_score: number;
  matched_skills: MatchedSkillItem[];
  missing_skills: MatchedSkillItem[];
  experience_comparison: string;
}

export const DEFAULT_WEIGHTS: WeightConfig = {
  skills: 0.40,
  semantic: 0.25,
  experience: 0.25,
  education: 0.10,
};

const TAXONOMY_PATH = path.resolve(process.cwd(), 'backend/app/data/skills_taxonomy.json');
const taxonomyRaw = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8')) as { skills: TaxonomyEntry[] };
const TAXONOMY: TaxonomyEntry[] = taxonomyRaw.skills;

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const entry of TAXONOMY) {
  ALIAS_TO_CANONICAL.set(entry.canonical.toLowerCase(), entry.canonical);
  for (const alias of entry.aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), entry.canonical);
  }
}

function getGenAIClient(): GoogleGenAI | null {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function normalizeSkill(skill: string): string {
  const clean = skill.trim();
  return ALIAS_TO_CANONICAL.get(clean.toLowerCase()) || clean;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSkillsFromText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const entry of TAXONOMY) {
    const terms = [entry.canonical, ...entry.aliases];
    for (const term of terms) {
      const escaped = escapeRegExp(term);
      const regex = new RegExp(`(?:^|[^a-zA-Z0-9+#_])${escaped}(?:$|[^a-zA-Z0-9+#_])`, 'i');
      if (regex.test(text)) {
        if (!seen.has(entry.canonical)) {
          seen.add(entry.canonical);
          found.push(entry.canonical);
        }
        break;
      }
    }
  }
  return found;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseMonthYear(monthStr: string | undefined, yearStr: string): number {
  const year = parseInt(yearStr, 10);
  const month = monthStr ? (MONTH_MAP[monthStr.toLowerCase()] ?? 6) : 6;
  return year * 12 + (month - 1);
}

export function computeDedupedExperienceYears(text: string): {
  years: number;
  history: Array<{ role: string; period: string; months: number }>;
} {
  const now = new Date();
  const currentYm = now.getFullYear() * 12 + now.getMonth();
  const dateRangeRegex =
    /(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(20\d{2}|19\d{2})\s*[-–—to]+\s*(?:(Present|Current|Now)|(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(20\d{2}|19\d{2}))/gi;

  const intervals: Array<[number, number]> = [];
  const history: Array<{ role: string; period: string; months: number }> = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const ln of lines) {
    if (/\b(B\.Tech|M\.Tech|B\.E\.|B\.Sc|M\.Sc|BCA|MCA|Bachelor|Master|University|College|Institute)\b/i.test(ln)) {
      continue;
    }
    let m: RegExpExecArray | null;
    dateRangeRegex.lastIndex = 0;
    while ((m = dateRangeRegex.exec(ln)) !== null) {
      const startYm = parseMonthYear(m[1], m[2]);
      const endYm = m[3] ? currentYm : parseMonthYear(m[4], m[5]);
      const endLabel = m[3] ? 'Present' : `${m[4] || ''} ${m[5]}`.trim();
      if (endYm >= startYm && endYm - startYm <= 40 * 12) {
        const safeEnd = Math.max(startYm + 1, endYm);
        intervals.push([startYm, safeEnd]);
        const roleLine = ln.replace(/\(.*?\)/g, '').replace(/^[-•\s]+/, '').trim();
        history.push({
          role: roleLine.slice(0, 120),
          period: `${m[1] || ''} ${m[2]} - ${endLabel}`.trim(),
          months: safeEnd - startYm,
        });
      }
    }
  }

  if (intervals.length > 0) {
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [s, e] of intervals) {
      if (merged.length === 0 || s > merged[merged.length - 1][1]) {
        merged.push([s, e]);
      } else {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
      }
    }
    const totalMonths = merged.reduce((acc, [s, e]) => acc + (e - s), 0);
    return { years: Math.round((totalMonths / 12) * 10) / 10, history };
  }

  const yrsMatch = text.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/i);
  return {
    years: yrsMatch ? parseFloat(yrsMatch[1]) : 0,
    history,
  };
}

export async function parseJobDescription(rawText: string): Promise<ParsedJD> {
  const ai = getGenAIClient();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Extract structured requirements from this job description:\n\n${rawText.slice(0, 6000)}`,
        config: {
          systemInstruction:
            'Extract concise canonical skill names, nice-to-have skills, minimum years of experience as a number, education requirement, role title, and key responsibilities.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              required_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
              preferred_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
              min_years: { type: Type.NUMBER },
              education: { type: Type.STRING },
              responsibilities: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['title', 'required_skills', 'preferred_skills', 'min_years', 'education'],
          },
        },
      });
      const parsed = JSON.parse(response.text || '{}') as Partial<ParsedJD>;
      if (parsed.title) {
        const reqSkills = Array.from(new Set((parsed.required_skills || []).map(normalizeSkill)));
        const prefSkills = Array.from(new Set((parsed.preferred_skills || []).map(normalizeSkill))).filter(
          (s) => !reqSkills.includes(s)
        );
        return {
          title: parsed.title,
          required_skills: reqSkills,
          preferred_skills: prefSkills,
          min_years: Number(parsed.min_years || 0),
          education: parsed.education || '',
          responsibilities: (parsed.responsibilities || []).slice(0, 6),
        };
      }
    } catch {
      // Graceful fallback to deterministic rule-based extraction
    }
  }

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] || 'Untitled Role';
  const titleMatch = firstLine.match(/^([A-Z][A-Za-z0-9\s/&+-]{2,60}?)(?:\.|,|$)/);
  const title = titleMatch ? titleMatch[1].trim() : firstLine.slice(0, 60);

  const sentences = rawText.split(/(?<=[.!?])\s+|\n+/);
  const requiredSkills: string[] = [];
  const preferredSkills: string[] = [];

  for (const sent of sentences) {
    const found = extractSkillsFromText(sent);
    if (/\b(plus|nice to have|preferred|bonus|desirable|optional)\b/i.test(sent)) {
      for (const s of found) {
        if (!preferredSkills.includes(s) && !requiredSkills.includes(s)) {
          preferredSkills.push(s);
        }
      }
    } else {
      for (const s of found) {
        if (!requiredSkills.includes(s)) {
          requiredSkills.push(s);
        }
      }
    }
  }

  const yrsMatch = rawText.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i);
  const minYears = yrsMatch ? parseFloat(yrsMatch[1]) : 0;

  const eduMatch = rawText.match(
    /(B\.Tech|M\.Tech|B\.E\.?|B\.Sc|M\.Sc|Bachelor(?:'s)?|Master(?:'s)?|Ph\.?D)[^\n.]{0,60}/i
  );
  const education = eduMatch ? eduMatch[0].trim() : '';

  const responsibilities = lines
    .filter((l) => l.startsWith('-') || l.startsWith('•'))
    .map((l) => l.replace(/^[-•\s]+/, '').trim())
    .slice(0, 6);

  return {
    title,
    required_skills: requiredSkills,
    preferred_skills: preferredSkills.filter((s) => !requiredSkills.includes(s)),
    min_years: minYears,
    education,
    responsibilities,
  };
}

export function extractCandidateProfile(rawText: string, filename: string) {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const emailMatch = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch = rawText.match(/(?:\+?\d[\d\s\-()]{8,16}\d)/);

  let name = '';
  if (lines.length > 0) {
    const candidateFirst = lines[0].replace(/[^A-Za-z\s.]/g, '').trim();
    const wordCount = candidateFirst.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 2 && wordCount <= 4) {
      name = candidateFirst;
    }
  }
  if (!name) {
    const base = path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ');
    name = base.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const skills = extractSkillsFromText(rawText);
  const { years, history } = computeDedupedExperienceYears(rawText);

  const eduEntries: Array<{ degree: string; details: string }> = [];
  const degRegex = /\b(Ph\.?D|Doctorate|M\.Tech|M\.S\.?|M\.Sc|MCA|MBA|Master(?:'s)?|B\.Tech|B\.E\.?|B\.Sc|BCA|Bachelor(?:'s)?)\b/i;
  for (const ln of lines) {
    const m = ln.match(degRegex);
    if (m) {
      eduEntries.push({ degree: m[1], details: ln.slice(0, 140) });
    }
  }

  const projects: string[] = [];
  let inProjects = false;
  for (const ln of lines) {
    if (/^projects?\s*:?$/i.test(ln)) {
      inProjects = true;
      continue;
    }
    if (inProjects) {
      if (/^(education|work experience|experience|skills|certifications)\s*:?$/i.test(ln)) break;
      projects.push(ln.replace(/^[-•\s]+/, ''));
    }
  }

  return {
    name,
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0].trim() : null,
    skills,
    total_experience_years: years,
    experience: history,
    education: eduEntries.slice(0, 3),
    projects: projects.slice(0, 5),
  };
}

// Embedding cache for Gemini embeddings + deterministic fallback
const EMBED_CACHE = new Map<string, number[]>();

async function getEmbeddings(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const missing = texts.filter((t) => !EMBED_CACHE.has(t));

  if (missing.length > 0) {
    const ai = getGenAIClient();
    if (!ai) return null;
    try {
      const res = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: missing,
      });
      if (res.embeddings && res.embeddings.length === missing.length) {
        missing.forEach((txt, i) => {
          const vals = res.embeddings?.[i]?.values;
          if (vals && vals.length > 0) {
            EMBED_CACHE.set(txt, vals);
          }
        });
      }
    } catch {
      return null;
    }
  }

  const out: number[][] = [];
  for (const t of texts) {
    const v = EMBED_CACHE.get(t);
    if (!v) return null;
    out.push(v);
  }
  return out;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function lexicalCosine(textA: string, textB: string): number {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1);
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  const freqA = new Map<string, number>();
  const freqB = new Map<string, number>();
  for (const t of tokensA) freqA.set(t, (freqA.get(t) || 0) + 1);
  for (const t of tokensB) freqB.set(t, (freqB.get(t) || 0) + 1);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, v] of freqA) normA += v * v;
  for (const [k, v] of freqB) {
    normB += v * v;
    const va = freqA.get(k);
    if (va) dot += va * v;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function computeOverallScore(
  skillScore: number,
  semanticScore: number,
  experienceScore: number,
  educationScore: number,
  weights: WeightConfig = DEFAULT_WEIGHTS
): number {
  const totalW = weights.skills + weights.semantic + weights.experience + weights.education || 1;
  const val =
    (weights.skills / totalW) * skillScore +
    (weights.semantic / totalW) * semanticScore +
    (weights.experience / totalW) * experienceScore +
    (weights.education / totalW) * educationScore;
  return Math.round(val * 10) / 10;
}

function degreeRank(text: string): number {
  const t = text.toLowerCase();
  if (/\b(ph\.?d|doctorate)\b/.test(t)) return 4;
  if (/\b(m\.tech|m\.s\.?|m\.sc|mca|mba|master)\b/.test(t)) return 3;
  if (/\b(b\.tech|b\.e\.?|b\.sc|bca|bachelor)\b/.test(t)) return 2;
  if (/\b(diploma|associate)\b/.test(t)) return 1;
  return 0;
}

function isCsField(text: string): boolean {
  return /\b(computer science|cse|cs|software|information technology|it|electronics|ece|data science|computing)\b/i.test(
    text
  );
}

export async function scoreCandidate(
  jdRaw: string,
  jdParsed: ParsedJD,
  candidateData: {
    skills: string[];
    total_experience_years: number;
    education: Array<{ degree: string; details: string }>;
    raw_text: string;
  },
  weights: WeightConfig = DEFAULT_WEIGHTS
): Promise<ScoreOutput> {
  // 1. Skill score (40%)
  const candSet = new Set(candidateData.skills.map(normalizeSkill));
  const jdItems: Array<{ skill: string; type: 'required' | 'nice_to_have'; weight: number }> = [];
  for (const s of jdParsed.required_skills) {
    jdItems.push({ skill: normalizeSkill(s), type: 'required', weight: 2.0 });
  }
  for (const s of jdParsed.preferred_skills) {
    const ns = normalizeSkill(s);
    if (!jdItems.some((x) => x.skill === ns)) {
      jdItems.push({ skill: ns, type: 'nice_to_have', weight: 1.0 });
    }
  }

  const matchedSkills: MatchedSkillItem[] = [];
  const missingSkills: MatchedSkillItem[] = [];
  let weightedMatched = 0;
  const weightedTotal = jdItems.reduce((acc, x) => acc + x.weight, 0);

  for (const item of jdItems) {
    if (candSet.has(item.skill)) {
      weightedMatched += item.weight;
      matchedSkills.push({
        skill: item.skill,
        type: item.type,
        matched_with: item.skill,
        similarity: 1.0,
      });
    } else {
      missingSkills.push({
        skill: item.skill,
        type: item.type,
        similarity: 0.0,
      });
    }
  }
  const skillScore =
    weightedTotal > 0 ? Math.round((weightedMatched / weightedTotal) * 1000) / 10 : 100;

  // 2. Semantic score (25%)
  const chunks = candidateData.raw_text
    .split(/\n{2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 25)
    .slice(0, 6);
  const safeChunks = chunks.length > 0 ? chunks : [candidateData.raw_text.slice(0, 1200)];

  let semanticScore = 0;
  const vecs = await getEmbeddings([jdRaw.slice(0, 2500), ...safeChunks]);
  if (vecs && vecs.length === safeChunks.length + 1) {
    const jdVec = vecs[0];
    const sims = vecs.slice(1).map((v) => cosineSimilarity(v, jdVec)).sort((a, b) => a - b);
    const topK = sims.slice(-Math.min(3, sims.length));
    const meanSim = topK.reduce((a, b) => a + b, 0) / topK.length;
    const rescaled = ((meanSim - 0.45) / (0.85 - 0.45)) * 100;
    semanticScore = Math.round(Math.max(0, Math.min(100, rescaled)) * 10) / 10;
  } else {
    const sims = safeChunks.map((c) => lexicalCosine(c, jdRaw)).sort((a, b) => a - b);
    const topK = sims.slice(-Math.min(3, sims.length));
    const meanSim = topK.reduce((a, b) => a + b, 0) / topK.length;
    const rescaled = ((meanSim - 0.1) / (0.55 - 0.1)) * 100;
    semanticScore = Math.round(Math.max(0, Math.min(100, rescaled)) * 10) / 10;
  }

  // 3. Experience score (25%)
  const reqYears = jdParsed.min_years || 0;
  const candYears = candidateData.total_experience_years || 0;
  let experienceScore = 100;
  let expLabel = 'Meets';
  if (reqYears > 0) {
    experienceScore = Math.round(Math.min(candYears / reqYears, 1) * 1000) / 10;
    expLabel = candYears > reqYears ? 'Exceeds' : candYears >= reqYears ? 'Meets' : 'Below';
  }

  // 4. Education score (10%)
  const eduText =
    candidateData.education.map((e) => e.details).join(' ') || candidateData.raw_text;
  const candRank = degreeRank(eduText);
  const reqRank = jdParsed.education ? degreeRank(jdParsed.education) : 2;
  let educationScore = 80;
  if (reqRank === 0) {
    educationScore = candRank >= 2 ? 80 : 60;
  } else if (candRank === 0) {
    educationScore = 30;
  } else {
    let base = candRank >= reqRank ? (candRank === reqRank ? 80 : 95) : 50;
    const jdCs = isCsField(jdParsed.education);
    const candCs = isCsField(eduText);
    if (jdCs && candCs) base = Math.min(100, base + 10);
    else if (jdCs && !candCs) base = Math.max(40, base - 15);
    educationScore = base;
  }

  const overallScore = computeOverallScore(
    skillScore,
    semanticScore,
    experienceScore,
    educationScore,
    weights
  );

  return {
    overall_score: overallScore,
    skill_score: skillScore,
    semantic_score: semanticScore,
    experience_score: experienceScore,
    education_score: educationScore,
    matched_skills: matchedSkills,
    missing_skills: missingSkills,
    experience_comparison: expLabel,
  };
}

export function buildRuleBasedExplanation(
  jdParsed: ParsedJD,
  candidateYears: number,
  scores: ScoreOutput
): string {
  const reqSkills = jdParsed.required_skills;
  const matchedReq = scores.matched_skills.filter((m) => m.type === 'required').map((m) => m.skill);
  const matchedNice = scores.matched_skills.filter((m) => m.type === 'nice_to_have').map((m) => m.skill);
  const missingNames = scores.missing_skills.map((m) => m.skill);

  const parts: string[] = [];
  if (reqSkills.length > 0) {
    let skillSentence = `Matched ${matchedReq.length} of ${reqSkills.length} required skills`;
    if (matchedNice.length > 0) {
      skillSentence += ` and the nice-to-have ${matchedNice.join(', ')}`;
    }
    if (missingNames.length > 0) {
      skillSentence += `; ${missingNames.join(', ')} not mentioned`;
    }
    parts.push(skillSentence + '.');
  }

  if (jdParsed.min_years > 0) {
    parts.push(
      `${candidateYears} years of relevant experience against ${jdParsed.min_years} required (${Math.round(scores.experience_score)}%).`
    );
  } else {
    parts.push(`${candidateYears} years of documented industry experience.`);
  }

  if (scores.semantic_score >= 70) {
    parts.push('Work history and projects show strong semantic similarity to the role responsibilities.');
  } else if (scores.semantic_score >= 45) {
    parts.push('Work history shows moderate semantic alignment with core responsibilities.');
  } else {
    parts.push('Limited semantic overlap between documented projects and target responsibilities.');
  }

  if (scores.education_score >= 80) {
    parts.push('Education meets or exceeds the stated degree requirement.');
  } else if (scores.education_score >= 50) {
    parts.push('Education partially aligns with the stated degree requirement.');
  } else {
    parts.push('Stated degree requirement is not clearly evidenced.');
  }

  return parts.join(' ');
}

export async function generateExplanation(
  jdParsed: ParsedJD,
  candidateYears: number,
  scores: ScoreOutput
): Promise<string> {
  const fallback = buildRuleBasedExplanation(jdParsed, candidateYears, scores);
  const ai = getGenAIClient();
  if (!ai) return fallback;

  try {
    const resp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        'Write a clear, concise 3-4 sentence recruiter summary explaining why this candidate received this exact match score.',
        'STRICT RULE: Narrate ONLY the exact numbers and facts below. Never alter scores or invent skills.',
        `Role: ${jdParsed.title}`,
        `Overall score: ${scores.overall_score}%`,
        `Skills score: ${scores.skill_score}/100 | Matched: ${scores.matched_skills.map((m) => m.skill).join(', ') || 'None'} | Missing: ${scores.missing_skills.map((m) => m.skill).join(', ') || 'None'}`,
        `Experience: ${candidateYears} yrs vs ${jdParsed.min_years} yrs required (${scores.experience_score}/100)`,
        `Semantic alignment: ${scores.semantic_score}/100 | Education score: ${scores.education_score}/100`,
      ].join('\n'),
    });
    const text = (resp.text || '').trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}
