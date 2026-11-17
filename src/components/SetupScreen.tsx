import React, { useRef, useState } from 'react';
import { Upload, FileText, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { CandidateUploadItem, JobSummary } from '../types';

const DEFAULT_SAMPLE_JD = `Senior Backend Developer. We need 4+ years building REST APIs with Python and FastAPI, PostgreSQL, Docker and CI/CD. React is a plus. B.Tech in Computer Science or equivalent.

Responsibilities:
- Design, build, and scale high-throughput RESTful services using Python and FastAPI.
- Architect PostgreSQL schemas, optimize queries, and manage migrations.
- Containerize microservices with Docker and maintain automated CI/CD pipelines.`;

interface SetupScreenProps {
  currentJob: JobSummary | null;
  uploadedFiles: CandidateUploadItem[];
  isParsingJob: boolean;
  isUploadingResumes: boolean;
  errorMsg: string | null;
  onCreateJobText: (text: string) => Promise<JobSummary>;
  onCreateJobFile: (file: File) => Promise<JobSummary>;
  onUploadResumes: (jobId: number, files: File[]) => Promise<void>;
  onLoadSampleBatch: (text: string) => Promise<void>;
  onRunMatching: () => Promise<void>;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({
  currentJob,
  uploadedFiles,
  isParsingJob,
  isUploadingResumes,
  errorMsg,
  onCreateJobText,
  onCreateJobFile,
  onUploadResumes,
  onLoadSampleBatch,
  onRunMatching,
}) => {
  const [jdMode, setJdMode] = useState<'paste' | 'upload'>('paste');
  const [jdText, setJdText] = useState<string>(currentJob?.raw_text || DEFAULT_SAMPLE_JD);
  const [jdFilename, setJdFilename] = useState<string>('');
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [isDraggingResumes, setIsDraggingResumes] = useState(false);
  const jdFileRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  const parsedCount = uploadedFiles.filter((f) => f.parse_status === 'Parsed').length;
  const totalCount = uploadedFiles.length;
  const visibleFiles = showAllFiles ? uploadedFiles : uploadedFiles.slice(0, 4);
  const hiddenCount = Math.max(0, uploadedFiles.length - 4);

  const handleAnalyzeJd = async () => {
    if (!jdText.trim()) return;
    await onCreateJobText(jdText.trim());
  };

  const handleJdFileChange = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setJdFilename(file.name);
    const job = await onCreateJobFile(file);
    setJdText(job.raw_text);
  };

  const handleResumeFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    let job = currentJob;
    if (!job || job.raw_text.trim() !== jdText.trim()) {
      job = await onCreateJobText(jdText.trim() || DEFAULT_SAMPLE_JD);
    }
    await onUploadResumes(job.id, files);
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">New screening</h1>
          <p className="mt-1 text-sm text-slate-500">
            Provide a job description and upload a batch of 10 or more PDF or DOCX resumes to rank candidates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onLoadSampleBatch(jdText.trim() || DEFAULT_SAMPLE_JD)}
          disabled={isParsingJob || isUploadingResumes}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Sparkles className="h-4 w-4 text-blue-600" />
          Load 12 sample resumes
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        {/* Left panel: 1. Job description */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900">1. Job description</h2>
            {currentJob && (
              <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">
                Requirements extracted
              </span>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setJdMode('paste')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                jdMode === 'paste'
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Paste text
            </button>
            <button
              type="button"
              onClick={() => setJdMode('upload')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                jdMode === 'upload'
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Upload file
            </button>
          </div>

          {jdMode === 'paste' ? (
            <div className="mt-4 space-y-3">
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={5}
                placeholder="Paste the role title, required skills, nice-to-have skills, years of experience, and degree requirements..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">
                  Supports structured extraction via Gemini or local rules
                </span>
                <button
                  type="button"
                  onClick={handleAnalyzeJd}
                  disabled={isParsingJob || !jdText.trim()}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {isParsingJob ? 'Extracting...' : 'Extract requirements'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <input
                ref={jdFileRef}
                type="file"
                accept=".pdf,.docx,.txt"
                className="hidden"
                onChange={(e) => handleJdFileChange(e.target.files)}
              />
              <button
                type="button"
                onClick={() => jdFileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/30"
              >
                <FileText className="h-6 w-6 text-slate-400" />
                <span className="mt-2 text-sm font-semibold text-slate-800">
                  {jdFilename || 'Select JD file (PDF, DOCX, or TXT)'}
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  Click to browse from your computer
                </span>
              </button>
            </div>
          )}

          {/* Extracted requirements divider */}
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">Extracted requirements</h3>
            {currentJob ? (
              <div className="mt-3 space-y-3.5">
                <div>
                  <div className="text-xs font-medium text-slate-500">Required skills</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {currentJob.parsed.required_skills.length > 0 ? (
                      currentJob.parsed.required_skills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                        >
                          {skill}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">None detected</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-slate-500">Nice to have</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {currentJob.parsed.preferred_skills.length > 0 ? (
                      currentJob.parsed.preferred_skills.map((skill) => (
                        <span
                          key={skill}
                          className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                        >
                          {skill}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">None specified</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <div className="text-xs font-medium text-slate-500">Experience</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900 font-mono-num">
                      {currentJob.parsed.min_years > 0
                        ? `${currentJob.parsed.min_years}+ years`
                        : 'Not specified'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-slate-500">Education</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
                      {currentJob.parsed.education || 'Not specified'}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                Click &ldquo;Extract requirements&rdquo; or upload a resume batch to inspect parsed required skills, nice-to-have skills, experience, and degree criteria.
              </p>
            )}
          </div>
        </section>

        {/* Right panel: 2. Resumes */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900">2. Resumes</h2>
            {totalCount > 0 && (
              <span className="text-xs text-slate-500 font-mono-num">
                {totalCount} files attached
              </span>
            )}
          </div>

          <input
            ref={resumeInputRef}
            type="file"
            multiple
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => handleResumeFiles(e.target.files)}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingResumes(true);
            }}
            onDragLeave={() => setIsDraggingResumes(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingResumes(false);
              handleResumeFiles(e.dataTransfer.files);
            }}
            onClick={() => resumeInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') resumeInputRef.current?.click();
            }}
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${
              isDraggingResumes
                ? 'border-blue-500 bg-blue-50/50'
                : 'border-slate-300 bg-slate-50/60 hover:border-blue-400 hover:bg-slate-50'
            }`}
          >
            <Upload className="h-5 w-5 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {isUploadingResumes ? 'Parsing uploaded resumes...' : 'Drop PDF or DOCX files here'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Upload 10 or more resumes in one batch (synthetic resumes only)
            </p>
          </div>

          {uploadedFiles.length > 0 ? (
            <div className="mt-4 divide-y divide-slate-100">
              {visibleFiles.map((file) => {
                const isParsed = file.parse_status === 'Parsed';
                return (
                  <div
                    key={file.id}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <span className="truncate font-medium text-slate-800">{file.filename}</span>
                      {file.file_size_bytes > 0 && (
                        <span className="text-xs text-slate-400 font-mono-num shrink-0">
                          {formatBytes(file.file_size_bytes)}
                        </span>
                      )}
                    </div>
                    <span
                      className={`rounded-md px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                        isParsed
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {file.parse_status}
                    </span>
                  </div>
                );
              })}

              {hiddenCount > 0 && (
                <div className="pt-3">
                  <button
                    type="button"
                    onClick={() => setShowAllFiles((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    {showAllFiles ? (
                      <>
                        <ChevronUp className="h-3.5 w-3.5" /> Show fewer files
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" /> + {hiddenCount} more files
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-5 rounded-lg bg-slate-50 px-4 py-4 text-xs text-slate-500">
              No resumes attached yet. Drop PDF or DOCX files above, or click &ldquo;Load 12 sample resumes&rdquo; to test with 11 valid synthetic resumes and 1 scanned PDF failure case.
            </div>
          )}
        </section>
      </div>

      {/* Bottom footer bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <div className="text-sm text-slate-600 font-mono-num">
          {totalCount > 0
            ? `${parsedCount} of ${totalCount} resumes parsed`
            : 'Ready for batch upload'}
        </div>
        <button
          type="button"
          onClick={onRunMatching}
          disabled={parsedCount === 0 || isUploadingResumes || isParsingJob}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap shrink-0"
        >
          Run matching
        </button>
      </div>
    </div>
  );
};
