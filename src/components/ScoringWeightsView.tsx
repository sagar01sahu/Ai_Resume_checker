import React from 'react';
import type { RankedCandidateItem, WeightConfig } from '../types';

interface ScoringWeightsViewProps {
  weights: WeightConfig;
  liveCandidates: RankedCandidateItem[];
  onWeightsChange: (next: WeightConfig) => void;
  onApplyToRanking: () => void;
  onResetDefault: () => void;
  onSelectCandidate: (candidateId: number) => void;
}

const DEFAULT_PCT = {
  skills: 40,
  semantic: 25,
  experience: 25,
  education: 10,
};

export const ScoringWeightsView: React.FC<ScoringWeightsViewProps> = ({
  weights,
  liveCandidates,
  onWeightsChange,
  onApplyToRanking,
  onResetDefault,
  onSelectCandidate,
}) => {
  const pct = {
    skills: Math.round(weights.skills * 100),
    semantic: Math.round(weights.semantic * 100),
    experience: Math.round(weights.experience * 100),
    education: Math.round(weights.education * 100),
  };

  // Rebalance other weights proportionally so total always equals 100%
  const handleSliderChange = (changedKey: keyof WeightConfig, newValPct: number) => {
    const clamped = Math.max(0, Math.min(100, newValPct));
    const remaining = 100 - clamped;
    const otherKeys = (['skills', 'semantic', 'experience', 'education'] as const).filter(
      (k) => k !== changedKey
    );
    const otherSum = otherKeys.reduce((acc, k) => acc + pct[k], 0);

    const updatedPct: Record<keyof WeightConfig, number> = { ...pct, [changedKey]: clamped };
    if (otherSum === 0) {
      const each = Math.floor(remaining / otherKeys.length);
      otherKeys.forEach((k, idx) => {
        updatedPct[k] = idx === 0 ? remaining - each * (otherKeys.length - 1) : each;
      });
    } else {
      let distributed = 0;
      otherKeys.forEach((k, idx) => {
        if (idx === otherKeys.length - 1) {
          updatedPct[k] = Math.max(0, remaining - distributed);
        } else {
          const share = Math.round((pct[k] / otherSum) * remaining);
          updatedPct[k] = share;
          distributed += share;
        }
      });
    }

    onWeightsChange({
      skills: updatedPct.skills / 100,
      semantic: updatedPct.semantic / 100,
      experience: updatedPct.experience / 100,
      education: updatedPct.education / 100,
    });
  };

  const rows: Array<{ key: keyof WeightConfig; label: string; value: number }> = [
    { key: 'skills', label: 'Skills', value: pct.skills },
    { key: 'semantic', label: 'Semantic similarity', value: pct.semantic },
    { key: 'experience', label: 'Experience', value: pct.experience },
    { key: 'education', label: 'Education', value: pct.education },
  ];

  const isDefault =
    pct.skills === DEFAULT_PCT.skills &&
    pct.semantic === DEFAULT_PCT.semantic &&
    pct.experience === DEFAULT_PCT.experience &&
    pct.education === DEFAULT_PCT.education;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Scoring weights</h1>
        <p className="mt-1 text-sm text-slate-500">
          Change what matters most and the ranking updates. Weights always total 100%.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        {/* Left card: Weights */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <h2 className="text-base font-semibold text-slate-900">Weights</h2>

          <div className="space-y-4">
            {rows.map((row) => (
              <div key={row.key} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-800">{row.label}</span>
                  <span className="font-mono-num font-semibold text-slate-900">{row.value}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={row.value}
                  onChange={(e) => handleSliderChange(row.key, Number(e.target.value))}
                  aria-label={`${row.label} weight percentage`}
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onApplyToRanking}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onResetDefault}
              disabled={isDefault}
              className="rounded-lg border border-blue-200 bg-white px-5 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              Reset to default
            </button>
          </div>
        </section>

        {/* Right card: Live ranking */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Live ranking</h2>

          {liveCandidates.length === 0 ? (
            <p className="text-sm text-slate-500 py-6">
              Run matching on a screening batch first to preview live rank changes.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {liveCandidates.slice(0, 8).map((cand) => {
                let deltaText = 'same';
                let deltaClass = 'text-slate-500';
                if (cand.rank_delta > 0) {
                  deltaText = `up ${cand.rank_delta}`;
                  deltaClass = 'text-emerald-700 font-medium';
                } else if (cand.rank_delta < 0) {
                  deltaText = `down ${Math.abs(cand.rank_delta)}`;
                  deltaClass = 'text-red-700 font-medium';
                }

                return (
                  <div
                    key={cand.candidate_id}
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <span className="w-5 font-mono-num text-slate-500">{cand.rank}</span>
                      <button
                        type="button"
                        onClick={() => onSelectCandidate(cand.candidate_id)}
                        className="truncate font-semibold text-slate-900 hover:text-blue-600 text-left"
                      >
                        {cand.name}
                      </button>
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <span className="font-mono-num font-bold text-slate-900">
                        {Math.round(cand.overall_score)}%
                      </span>
                      <span className={`w-16 text-right text-xs font-mono-num ${deltaClass}`}>
                        {deltaText}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
            Delta indicators show rank movement from the default weights (40 / 25 / 25 / 10).
          </p>
        </section>
      </div>
    </div>
  );
};
