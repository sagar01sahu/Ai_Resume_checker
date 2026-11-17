import React from 'react';
import { Download } from 'lucide-react';
import { getExportCsvUrl } from '../api';
import type { RankingResponse } from '../types';

interface CompareCandidatesViewProps {
  ranking: RankingResponse | null;
  selectedIds: number[];
  onBackToRanking: () => void;
}

export const CompareCandidatesView: React.FC<CompareCandidatesViewProps> = ({
  ranking,
  selectedIds,
  onBackToRanking,
}) => {
  if (!ranking || ranking.candidates.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
        <p className="text-sm text-slate-600">
          No ranked candidates available to compare yet.
        </p>
        <button
          type="button"
          onClick={onBackToRanking}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Go to ranking
        </button>
      </div>
    );
  }

  const chosen =
    selectedIds.length >= 2
      ? ranking.candidates.filter((c) => selectedIds.includes(c.candidate_id)).slice(0, 4)
      : ranking.candidates.slice(0, 3);

  const jdSkills = [
    ...ranking.job.parsed.required_skills,
    ...ranking.job.parsed.preferred_skills.filter(
      (s) => !ranking.job.parsed.required_skills.includes(s)
    ),
  ];

  const allSkills =
    jdSkills.length > 0
      ? jdSkills
      : Array.from(
          new Set(
            chosen.flatMap((c) => [
              ...c.matched_skills.map((m) => m.skill),
              ...c.missing_skills.map((m) => m.skill),
            ])
          )
        );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Compare candidates</h1>
          <p className="mt-1 text-sm text-slate-500">
            Skill gap against the job description.{' '}
            {selectedIds.length >= 2
              ? `${chosen.length} selected.`
              : `Top ${chosen.length} selected.`}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToRanking}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Back to ranking
          </button>
          <a
            href={getExportCsvUrl(ranking.job.id, 0)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <th className="px-5 py-3.5 text-xs font-semibold tracking-wider text-slate-500">
                REQUIRED SKILL
              </th>
              {chosen.map((c) => (
                <th
                  key={c.candidate_id}
                  className="px-5 py-3.5 text-center text-xs font-semibold tracking-wider text-slate-700"
                >
                  {c.name.split(' ')[0].toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allSkills.map((skill) => {
              const isNice = ranking.job.parsed.preferred_skills.includes(skill);
              return (
                <tr key={skill} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                    {skill}
                    {isNice && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        (nice to have)
                      </span>
                    )}
                  </td>
                  {chosen.map((c) => {
                    const isMatched = c.matched_skills.some((m) => m.skill === skill);
                    return (
                      <td key={c.candidate_id} className="px-5 py-3.5 text-center">
                        <span
                          className={`inline-block rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap ${
                            isMatched
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {isMatched ? 'Matched' : 'Missing'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            <tr className="border-t border-slate-200 bg-slate-50/40">
              <td className="px-5 py-4 text-sm font-bold text-slate-900">Overall match</td>
              {chosen.map((c) => (
                <td
                  key={c.candidate_id}
                  className="px-5 py-4 text-center text-sm font-bold text-slate-900 font-mono-num"
                >
                  {Math.round(c.overall_score)}%
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
