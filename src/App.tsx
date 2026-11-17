import { useCallback, useEffect, useState } from 'react';
import {
  cancelMatching,
  createJobFromFile,
  createJobFromText,
  deleteJob,
  getCandidateDetail,
  getMatchStatus,
  getRanking,
  listJobs,
  loadSampleResumes,
  startMatching,
  uploadResumes,
} from './api';
import { CandidateDetailView } from './components/CandidateDetailView';
import { CompareCandidatesView } from './components/CompareCandidatesView';
import { MatchingProgress } from './components/MatchingProgress';
import { PastScreeningsView } from './components/PastScreeningsView';
import { RankingDashboard } from './components/RankingDashboard';
import { ScoringWeightsView } from './components/ScoringWeightsView';
import { SetupScreen } from './components/SetupScreen';
import type {
  CandidateDetail,
  CandidateUploadItem,
  JobSummary,
  MatchStatusResponse,
  RankingResponse,
  WeightConfig,
} from './types';

type ScreenTab = 'setup' | 'progress' | 'ranking' | 'candidate' | 'weights' | 'compare' | 'history';

const DEFAULT_WEIGHTS: WeightConfig = {
  skills: 0.40,
  semantic: 0.25,
  experience: 0.25,
  education: 0.10,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ScreenTab>('setup');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [currentJob, setCurrentJob] = useState<JobSummary | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<CandidateUploadItem[]>([]);
  const [matchStatus, setMatchStatus] = useState<MatchStatusResponse | null>(null);
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [candidateDetail, setCandidateDetail] = useState<CandidateDetail | null>(null);
  const [loadingCandidate, setLoadingCandidate] = useState(false);

  const [weights, setWeights] = useState<WeightConfig>(DEFAULT_WEIGHTS);
  const [minScore, setMinScore] = useState<number>(0);
  const [selectedCompareIds, setSelectedCompareIds] = useState<number[]>([]);

  const [isParsingJob, setIsParsingJob] = useState(false);
  const [isUploadingResumes, setIsUploadingResumes] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshJobsList = useCallback(async () => {
    try {
      const data = await listJobs();
      setJobs(data);
    } catch {
      // ignore initial list failure
    }
  }, []);

  useEffect(() => {
    refreshJobsList();
  }, [refreshJobsList]);

  const fetchRankingData = useCallback(
    async (jobId: number, scoreFilter: number, activeWeights: WeightConfig) => {
      const data = await getRanking(jobId, scoreFilter, activeWeights);
      setRanking(data);
      return data;
    },
    []
  );

  // Poll matching progress when on progress screen
  useEffect(() => {
    if (activeTab !== 'progress' || !currentJob) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const st = await getMatchStatus(currentJob.id);
        if (cancelled) return;
        setMatchStatus(st);
        if (st.phase === 'done') {
          await fetchRankingData(currentJob.id, minScore, weights);
          await refreshJobsList();
          setActiveTab('ranking');
        } else if (st.phase === 'cancelled') {
          setActiveTab('setup');
        } else if (st.phase === 'error') {
          setErrorMsg(st.error || 'Matching failed');
          setActiveTab('setup');
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Status check failed');
        }
      }
    };

    poll();
    const timer = setInterval(poll, 600);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab, currentJob, fetchRankingData, minScore, refreshJobsList, weights]);

  // Re-fetch ranking whenever minScore or weights change on ranking/weights views
  useEffect(() => {
    if (!currentJob) return;
    if (activeTab === 'ranking' || activeTab === 'weights') {
      fetchRankingData(currentJob.id, activeTab === 'weights' ? 0 : minScore, weights).catch(
        () => {}
      );
    }
  }, [activeTab, currentJob, fetchRankingData, minScore, weights]);

  const handleCreateJobText = async (text: string): Promise<JobSummary> => {
    setErrorMsg(null);
    setIsParsingJob(true);
    try {
      const created = await createJobFromText(text);
      setCurrentJob(created);
      setUploadedFiles([]);
      setRanking(null);
      setCandidateDetail(null);
      await refreshJobsList();
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not parse job description';
      setErrorMsg(msg);
      throw err;
    } finally {
      setIsParsingJob(false);
    }
  };

  const handleCreateJobFile = async (file: File): Promise<JobSummary> => {
    setErrorMsg(null);
    setIsParsingJob(true);
    try {
      const created = await createJobFromFile(file);
      setCurrentJob(created);
      setUploadedFiles([]);
      setRanking(null);
      setCandidateDetail(null);
      await refreshJobsList();
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not parse JD file';
      setErrorMsg(msg);
      throw err;
    } finally {
      setIsParsingJob(false);
    }
  };

  const handleUploadResumes = async (jobId: number, files: File[]) => {
    setErrorMsg(null);
    setIsUploadingResumes(true);
    try {
      const res = await uploadResumes(jobId, files);
      setUploadedFiles((prev) => [...prev, ...res.candidates]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resume upload failed');
    } finally {
      setIsUploadingResumes(false);
    }
  };

  const handleLoadSampleBatch = async (jdText: string) => {
    setErrorMsg(null);
    setIsParsingJob(true);
    setIsUploadingResumes(true);
    try {
      let job = currentJob;
      if (!job || job.raw_text.trim() !== jdText.trim()) {
        job = await createJobFromText(jdText);
        setCurrentJob(job);
      }
      const batch = await loadSampleResumes(job.id);
      setUploadedFiles(batch.candidates);
      setRanking(null);
      setCandidateDetail(null);
      await refreshJobsList();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load sample resumes');
    } finally {
      setIsParsingJob(false);
      setIsUploadingResumes(false);
    }
  };

  const handleRunMatching = async () => {
    if (!currentJob) return;
    setErrorMsg(null);
    try {
      await startMatching(currentJob.id, weights);
      setActiveTab('progress');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start matching');
    }
  };

  const handleCancelMatching = async () => {
    if (!currentJob) return;
    await cancelMatching(currentJob.id);
    setActiveTab('setup');
  };

  const handleSelectCandidate = async (candidateId: number) => {
    setLoadingCandidate(true);
    setActiveTab('candidate');
    try {
      const detail = await getCandidateDetail(candidateId);
      setCandidateDetail(detail);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load candidate details');
    } finally {
      setLoadingCandidate(false);
    }
  };

  const handleOpenPastJob = async (jobId: number) => {
    setErrorMsg(null);
    try {
      const data = await getRanking(jobId, minScore, weights);
      setCurrentJob(data.job);
      setRanking(data);
      setSelectedCompareIds([]);
      setActiveTab('ranking');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not open screening');
    }
  };

  const handleDeleteJob = async (jobId: number) => {
    await deleteJob(jobId);
    if (currentJob?.id === jobId) {
      setCurrentJob(null);
      setRanking(null);
      setUploadedFiles([]);
    }
    await refreshJobsList();
  };

  const handleStartNewScreening = () => {
    setCurrentJob(null);
    setUploadedFiles([]);
    setRanking(null);
    setCandidateDetail(null);
    setSelectedCompareIds([]);
    setErrorMsg(null);
    setActiveTab('setup');
  };

  const handleToggleCompareId = (candidateId: number) => {
    setSelectedCompareIds((prev) =>
      prev.includes(candidateId)
        ? prev.filter((id) => id !== candidateId)
        : prev.length >= 4
          ? [...prev.slice(1), candidateId]
          : [...prev, candidateId]
    );
  };

  const navItems: Array<{ id: ScreenTab; label: string }> = [
    { id: 'setup', label: '1 Setup' },
    { id: 'ranking', label: '2 Ranking' },
    { id: 'candidate', label: '3 Candidate' },
    { id: 'weights', label: 'Scoring weights' },
    { id: 'compare', label: 'Compare' },
    { id: 'history', label: 'Past screenings' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Navigation Header — strict 3-zone contract */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6">
          <button
            type="button"
            onClick={() => setActiveTab('setup')}
            className="flex items-center gap-2.5 py-3.5 text-left whitespace-nowrap shrink-0"
          >
            <span className="inline-block h-6 w-6 rounded-md bg-blue-600" aria-hidden="true" />
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              ResumeRank
            </span>
          </button>

          <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary navigation">
            {navItems.map((item) => {
              const isActive =
                activeTab === item.id || (activeTab === 'progress' && item.id === 'setup');
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`border-b-2 py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-blue-600 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="shrink-0 hidden sm:block">
            <button
              type="button"
              onClick={handleStartNewScreening}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              New screening
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {activeTab === 'setup' && (
          <SetupScreen
            currentJob={currentJob}
            uploadedFiles={uploadedFiles}
            isParsingJob={isParsingJob}
            isUploadingResumes={isUploadingResumes}
            errorMsg={errorMsg}
            onCreateJobText={handleCreateJobText}
            onCreateJobFile={handleCreateJobFile}
            onUploadResumes={handleUploadResumes}
            onLoadSampleBatch={handleLoadSampleBatch}
            onRunMatching={handleRunMatching}
          />
        )}

        {activeTab === 'progress' && (
          <MatchingProgress
            jobTitle={currentJob?.title || 'Job screening'}
            status={matchStatus}
            onCancel={handleCancelMatching}
          />
        )}

        {activeTab === 'ranking' && (
          <RankingDashboard
            ranking={ranking}
            minScore={minScore}
            selectedCompareIds={selectedCompareIds}
            onMinScoreChange={setMinScore}
            onSelectCandidate={handleSelectCandidate}
            onToggleCompareId={handleToggleCompareId}
            onOpenCompare={() => setActiveTab('compare')}
          />
        )}

        {activeTab === 'candidate' && (
          <CandidateDetailView
            detail={candidateDetail}
            loading={loadingCandidate}
            onBackToRanking={() => setActiveTab('ranking')}
          />
        )}

        {activeTab === 'weights' && (
          <ScoringWeightsView
            weights={weights}
            liveCandidates={ranking?.candidates ?? []}
            onWeightsChange={setWeights}
            onApplyToRanking={() => setActiveTab('ranking')}
            onResetDefault={() => setWeights(DEFAULT_WEIGHTS)}
            onSelectCandidate={handleSelectCandidate}
          />
        )}

        {activeTab === 'compare' && (
          <CompareCandidatesView
            ranking={ranking}
            selectedIds={selectedCompareIds}
            onBackToRanking={() => setActiveTab('ranking')}
          />
        )}

        {activeTab === 'history' && (
          <PastScreeningsView
            jobs={jobs}
            activeJobId={currentJob?.id ?? null}
            onOpenJob={handleOpenPastJob}
            onDeleteJob={handleDeleteJob}
            onNewScreening={handleStartNewScreening}
          />
        )}
      </main>
    </div>
  );
}
