import React, { useMemo, useState } from 'react';
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, Download, Search, AlertTriangle } from 'lucide-react';
import { getExportCsvUrl } from '../api';
import type { RankedCandidateItem, RankingResponse } from '../types';

interface RankingDashboardProps {
  ranking: RankingResponse | null;
  minScore: number;
  selectedCompareIds: number[];
  onMinScoreChange: (val: number) => void;
  onSelectCandidate: (candidateId: number) => void;
  onToggleCompareId: (candidateId: number) => void;
  onOpenCompare: () => void;
}

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

const columnHelper = createColumnHelper<typeof features, RankedCandidateItem>();

export const RankingDashboard: React.FC<RankingDashboardProps> = ({
  ranking,
  minScore,
  selectedCompareIds,
  onMinScoreChange,
  onSelectCandidate,
  onToggleCompareId,
  onOpenCompare,
}) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredData = useMemo(() => {
    const items = ranking?.candidates ?? [];
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.matched_skills.some((s) => s.skill.toLowerCase().includes(q))
    );
  }, [ranking, searchQuery]);

  const columns = useMemo<ColumnDef<typeof features, RankedCandidateItem, any>[]>(
    () => [
      columnHelper.display({
        id: 'select',
        header: () => <span className="sr-only">Compare</span>,
        cell: (info) => {
          const cid = info.row.original.candidate_id;
          const checked = selectedCompareIds.includes(cid);
          return (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleCompareId(cid)}
              aria-label={`Select ${info.row.original.name} for comparison`}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
          );
        },
      }),
      columnHelper.accessor('rank', {
        header: 'RANK',
        cell: (info) => (
          <span className="font-mono-num text-sm text-slate-700">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('name', {
        header: 'CANDIDATE',
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectCandidate(row.candidate_id)}
                className="font-semibold text-slate-900 hover:text-blue-600 text-left"
              >
                {info.getValue()}
              </button>
              {row.must_have_missing_count > 0 && (
                <span
                  title={`${row.must_have_missing_count} required skill(s) missing`}
                  className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 whitespace-nowrap"
                >
                  <AlertTriangle className="h-3 w-3" />
                  Missing {row.must_have_missing_count} req
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('experience_years', {
        header: 'EXPERIENCE',
        cell: (info) => (
          <span className="font-mono-num text-sm text-slate-600 whitespace-nowrap">
            {info.getValue()} yrs
          </span>
        ),
      }),
      columnHelper.accessor('overall_score', {
        header: 'MATCH %',
        cell: (info) => {
          const val = Math.round(info.getValue());
          return (
            <div className="flex items-center gap-3 min-w-[140px]">
              <span className="w-10 font-mono-num text-sm font-semibold text-slate-900">
                {val}%
              </span>
              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-blue-600"
                  style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                />
              </div>
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'matched_skills',
        header: 'MATCHED SKILLS',
        cell: (info) => {
          const skills = info.row.original.matched_skills.slice(0, 4);
          return (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span
                  key={s.skill}
                  className="rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 whitespace-nowrap"
                >
                  {s.skill}
                </span>
              ))}
              {info.row.original.matched_skills.length > 4 && (
                <span className="text-xs text-slate-400 self-center">
                  +{info.row.original.matched_skills.length - 4}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => (
          <div className="text-right">
            <button
              type="button"
              onClick={() => onSelectCandidate(info.row.original.candidate_id)}
              className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
            >
              View
            </button>
          </div>
        ),
      }),
    ],
    [onSelectCandidate, onToggleCompareId, selectedCompareIds]
  );

  const table = useTable({
    features,
    columns,
    data: filteredData,
    initialState: {},
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (!ranking) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-sm text-slate-600">
          No active ranking yet. Run matching from Setup or open a past screening.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header row matching Screen 2 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {ranking.job.title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-mono-num">{ranking.ranked_count}</span> candidates ranked
            {ranking.failed_files.length > 0 && (
              <span>
                {' '}· <span className="font-mono-num">{ranking.failed_files.length}</span> skipped ({ranking.failed_files.map((f) => f.filename).join(', ')})
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search candidate or skill"
              className="rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <label className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3.5 py-2 text-sm font-medium text-blue-700 whitespace-nowrap shrink-0">
            <span>Min score:</span>
            <select
              value={minScore}
              onChange={(e) => onMinScoreChange(Number(e.target.value))}
              className="bg-transparent font-mono-num font-semibold text-blue-700 focus:outline-none"
            >
              <option value={0}>0%</option>
              <option value={40}>40%</option>
              <option value={50}>50%</option>
              <option value={60}>60%</option>
              <option value={75}>75%</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onOpenCompare}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            {selectedCompareIds.length >= 2
              ? `Compare (${selectedCompareIds.length})`
              : 'Compare top 3'}
          </button>

          <a
            href={getExportCsvUrl(ranking.job.id, minScore)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </div>
      </div>

      {/* TanStack Table v9 */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-slate-200 bg-slate-50/80">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      className={`px-4 py-3 text-xs font-semibold tracking-wider text-slate-500 ${
                        canSort ? 'cursor-pointer select-none hover:text-slate-800' : ''
                      }`}
                    >
                      <div className="inline-flex items-center gap-1">
                        <table.FlexRender header={header} />
                        {canSort && header.column.columnDef.header && (
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                  No candidates match the current score threshold or search filter.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50/70">
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3.5 align-middle">
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
