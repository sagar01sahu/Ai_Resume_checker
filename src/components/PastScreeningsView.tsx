import React from 'react';
import { Trash2 } from 'lucide-react';
import type { JobSummary } from '../types';

interface PastScreeningsViewProps {
  jobs: JobSummary[];
  activeJobId: number | null;
  onOpenJob: (jobId: number) => Promise<void>;
  onDeleteJob: (jobId: number) => Promise<void>;
  onNewScreening: () => void;
}

export const PastScreeningsView: React.FC<PastScreeningsViewProps> = ({
  jobs,
  activeJobId,
  onOpenJob,
  onDeleteJob,
  onNewScreening,
}) => {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Past screenings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Reopen any previously parsed job description and ranked candidate batch.
          </p>
        </div>
        <button
          type="button"
          onClick={onNewScreening}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          New screening
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center space-y-3">
          <p className="text-sm text-slate-600">No saved screenings yet.</p>
          <button
            type="button"
            onClick={onNewScreening}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Start your first screening
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-slate-900">{job.title}</span>
                  {activeJobId === job.id && (
                    <span className="text-xs font-medium text-blue-700">Current</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono-num">
                    {job.parsed_count} of {job.candidate_count} resumes parsed
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{new Date(job.created_at).toLocaleString()}</span>
                  {job.parsed.required_skills.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{job.parsed.required_skills.slice(0, 4).join(', ')}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onOpenJob(job.id)}
                  className="rounded-lg border border-blue-200 bg-white px-4 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 whitespace-nowrap"
                >
                  Open ranking
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteJob(job.id)}
                  aria-label={`Delete ${job.title}`}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-red-200 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
