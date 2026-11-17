import React from 'react';
import type { MatchStatusResponse, MatchStepState } from '../types';

interface MatchingProgressProps {
  jobTitle: string;
  status: MatchStatusResponse | null;
  onCancel: () => Promise<void>;
}

const StepRow: React.FC<{ label: string; step?: MatchStepState }> = ({ label, step }) => {
  const done = step?.done ?? 0;
  const total = step?.total ?? 0;
  const state = step?.status ?? 'waiting';
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  let statusText = 'Waiting';
  if (state === 'done') {
    statusText = `${done} of ${total} done`;
  } else if (state === 'running') {
    statusText = `${done} of ${total} done`;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-900">{label}</span>
        <span className="text-slate-600 font-mono-num">{statusText}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-600 transition-all duration-300"
          style={{ width: `${state === 'waiting' ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
};

export const MatchingProgress: React.FC<MatchingProgressProps> = ({
  jobTitle,
  status,
  onCancel,
}) => {
  const totalParsed = status?.total_parsed ?? 0;
  const skipped = status?.skipped ?? [];
  const steps = status?.steps;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Matching in progress</h1>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
        <p className="text-sm text-slate-600">
          {jobTitle}: scoring <span className="font-mono-num font-medium">{totalParsed}</span> resumes against the job description.
        </p>

        <div className="space-y-5">
          <StepRow label="Reading files" step={steps?.reading} />
          <StepRow label="Extracting skills and experience" step={steps?.extracting} />
          <StepRow label="Embedding and scoring" step={steps?.embedding} />
          <StepRow label="Writing explanations" step={steps?.explaining} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
          <div className="text-sm text-slate-600">
            {skipped.length > 0 ? (
              <span>
                {skipped.length} {skipped.length === 1 ? 'file' : 'files'} skipped:{' '}
                {skipped.map((s) => `${s.filename} (${s.reason.replace('Failed: ', '')})`).join(', ')}
              </span>
            ) : (
              <span>All uploaded files parsed cleanly</span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-blue-600 bg-white px-5 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
