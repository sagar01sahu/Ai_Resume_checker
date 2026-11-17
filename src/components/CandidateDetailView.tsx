import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import type { CandidateDetail } from '../types';

interface CandidateDetailViewProps {
  detail: CandidateDetail | null;
  loading: boolean;
  onBackToRanking: () => void;
}

const BreakdownBar: React.FC<{ label: string; score: number }> = ({ label, score }) => {
  const rounded = Math.round(score);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-medium text-slate-700">
        <span>{label}</span>
        <span className="font-mono-num font-semibold text-slate-900">{rounded}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600"
          style={{ width: `${Math.min(100, Math.max(0, rounded))}%` }}
        />
      </div>
    </div>
  );
};

export const CandidateDetailView: React.FC<CandidateDetailViewProps> = ({
  detail,
  loading,
  onBackToRanking,
}) => {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Loading candidate analysis...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Select a candidate from the Ranking table to inspect their full score breakdown and explanation.
      </div>
    );
  }

  const matchedRequiredCount = detail.matched_skills.filter((m) => m.type === 'required').length;
  const totalRequiredCount =
    matchedRequiredCount + detail.missing_skills.filter((m) => m.type === 'required').length;

  const primaryDegree = detail.education[0]?.details || detail.education[0]?.degree || 'Degree not listed';
  const expColor =
    detail.experience_comparison === 'Exceeds' || detail.experience_comparison === 'Meets'
      ? 'text-emerald-700'
      : 'text-amber-700';

  return (
    <div className="space-y-6">
      {/* Top header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{detail.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {detail.email && <span>{detail.email}</span>}
            {detail.email && <span aria-hidden="true">·</span>}
            <span className="font-mono-num">{detail.total_experience_years} years experience</span>
            <span aria-hidden="true">·</span>
            <span>{primaryDegree}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onBackToRanking}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to ranking
        </button>
      </div>

      {/* Main 2-column grid matching Screen 3 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left summary column */}
        <aside className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="text-center">
            <div className="text-xs font-medium text-slate-500">Overall match</div>
            <div className="mt-1 text-5xl font-bold tracking-tight text-blue-600 font-mono-num">
              {Math.round(detail.overall_score)}%
            </div>
            <div className="mt-1.5 text-sm text-slate-600 font-mono-num">
              Rank {detail.rank} of {detail.total_ranked}
            </div>
          </div>

          <div className="space-y-4 border-t border-slate-100 pt-5">
            <BreakdownBar
              label={`Skills (${Math.round(detail.weights.skills * 100)}%)`}
              score={detail.skill_score}
            />
            <BreakdownBar
              label={`Semantic (${Math.round(detail.weights.semantic * 100)}%)`}
              score={detail.semantic_score}
            />
            <BreakdownBar
              label={`Experience (${Math.round(detail.weights.experience * 100)}%)`}
              score={detail.experience_score}
            />
            <BreakdownBar
              label={`Education (${Math.round(detail.weights.education * 100)}%)`}
              score={detail.education_score}
            />
          </div>

          <div className="border-t border-slate-100 pt-4 text-xs text-slate-500 leading-relaxed flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
            <span>{detail.bias_note}</span>
          </div>
        </aside>

        {/* Right detail stack */}
        <div className="lg:col-span-8 space-y-5">
          {/* Skills Card */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Skills</h2>
            <div>
              <div className="text-xs font-medium text-slate-500">
                Matched ({matchedRequiredCount} of {totalRequiredCount} required)
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {detail.matched_skills.length > 0 ? (
                  detail.matched_skills.map((m) => (
                    <span
                      key={m.skill}
                      className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                    >
                      {m.skill}
                      {m.type === 'nice_to_have' ? ' (nice to have)' : ''}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-400">No matched JD skills</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500">Missing</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {detail.missing_skills.length > 0 ? (
                  detail.missing_skills.map((m) => (
                    <span
                      key={m.skill}
                      className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"
                    >
                      {m.skill}
                      {m.type === 'nice_to_have' ? ' (nice to have)' : ''}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-emerald-700 font-medium">
                    No missing skills
                  </span>
                )}
              </div>
            </div>

            {/* Skill-gap bar chart (Section 10 extra) */}
            <div className="border-t border-slate-100 pt-4">
              <div className="text-xs font-medium text-slate-500 mb-2">
                Skill &amp; component profile
              </div>
              <div className="grid grid-cols-4 gap-3 items-end h-20 pt-2">
                {[
                  { name: 'Skills', val: detail.skill_score },
                  { name: 'Semantic', val: detail.semantic_score },
                  { name: 'Experience', val: detail.experience_score },
                  { name: 'Education', val: detail.education_score },
                ].map((bar) => (
                  <div key={bar.name} className="flex flex-col items-center gap-1 h-full justify-end">
                    <span className="text-[11px] font-mono-num text-slate-600">
                      {Math.round(bar.val)}
                    </span>
                    <div className="w-full max-w-[44px] bg-slate-100 rounded-t h-12 flex items-end overflow-hidden">
                      <div
                        className="w-full bg-blue-600 rounded-t transition-all"
                        style={{ height: `${Math.min(100, Math.max(4, Math.round(bar.val)))}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-slate-500">{bar.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Experience comparison */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Experience comparison</h2>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs font-medium text-slate-500">Required</div>
                <div className="mt-1 text-base font-bold text-slate-900 font-mono-num">
                  {detail.required_experience_years} years
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">Candidate</div>
                <div className="mt-1 text-base font-bold text-slate-900 font-mono-num">
                  {detail.total_experience_years} years
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500">Result</div>
                <div className={`mt-1 text-base font-bold ${expColor}`}>
                  {detail.experience_comparison}
                </div>
              </div>
            </div>

            {detail.experience.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3 space-y-1.5">
                <div className="text-xs font-medium text-slate-500">Extracted work history</div>
                {detail.experience.map((exp, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-4 text-xs text-slate-700">
                    <span className="truncate">{exp.role}</span>
                    <span className="font-mono-num text-slate-500 shrink-0">{exp.period}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Why this score */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">Why this score</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-slate-700">
              {detail.explanation}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
