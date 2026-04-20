export type ReviewCoverageMode = "full" | "partial";

export type ReviewCoverageDto = {
  mode: ReviewCoverageMode;
  analyzableFileCount: number;
  analyzedFileCount: number;
  skippedFileCount: number;
  skippedPaths: string[];
  reason: "file_budget" | "line_budget" | null;
  summary: string;
};

export type ReviewTimingDto = {
  fetchMs: number | null;
  biomeMs: number | null;
  semgrepMs: number | null;
  postprocessMs: number | null;
  publishMs: number | null;
  totalMs: number | null;
};

export type ReviewOutcome =
  | "running"
  | "blocking"
  | "comment_only"
  | "clean"
  | "failed";

export type ReviewDeltaDto = {
  newFindings: number;
  resolvedFindings: number;
  persistentFindings: number;
};

export type ReviewPublicationSummaryDto = {
  id: string;
  githubReviewId: string | null;
  status: string;
  reviewEvent: string | null;
  commentsCount: number;
  requestKey: string | null;
  body: string | null;
  submittedAt: string | null;
  error: string | null;
  createdAt: string;
};

export type DashboardHistoryRunDto = {
  id: string;
  repoId: string;
  prNumber: number;
  headSha: string;
  title: string | null;
  status: string;
  llmStatus: string;
  publishState: string;
  reviewOutcome: ReviewOutcome;
  mergeBlockReason: string | null;
  coverageMode: ReviewCoverageMode | null;
  coverageSummary: string | null;
  coverage: ReviewCoverageDto | null;
  timingSummary: string | null;
  pullRequestUrl: string;
  createdAt: string;
  updatedAt: string;
  counts: {
    findings: number;
    blockingFindings: number;
    publishedComments: number;
  };
  lastPublication: ReviewPublicationSummaryDto | null;
};

export type DashboardRunsSnapshot = {
  currentRun: ReviewRunDetailDto | null;
  history: DashboardHistoryRunDto[];
};

export type ChangedFileDto = {
  id: string;
  path: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  createdAt: string;
};

export type ReviewFindingDto = {
  id: string;
  path: string;
  lineStart: number;
  lineEnd: number | null;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  explanation: string;
  actionableFix: string | null;
  source: string;
  origin: string;
  ruleId: string | null;
  fingerprint: string | null;
  publish: boolean;
  publishReason: string | null;
  suppressionReason: string | null;
  metadata: unknown;
  createdAt: string;
};

export type ReviewCommentCandidateDto = {
  id: string;
  findingId: string | null;
  findingFingerprint: string | null;
  path: string;
  lineStart: number;
  lineEnd: number | null;
  body: string;
  severity: string;
  source: string;
  isPublishable: boolean;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
};

export type ReviewCommentPreviewDto = {
  id: string;
  candidateId: string | null;
  path: string;
  body: string;
  line: number | null;
  side: string | null;
  startLine: number | null;
  startSide: string | null;
  commitId: string | null;
  isValid: boolean;
  skipReason: string | null;
  payloadJson: unknown;
  metadata: unknown;
  createdAt: string;
};

export type ReviewRunDetailDto = {
  id: string;
  repoId: string;
  prNumber: number;
  headSha: string;
  baseSha: string | null;
  title: string | null;
  summary: string | null;
  status: string;
  llmStatus: string;
  publishState: string;
  reviewOutcome: ReviewOutcome;
  mergeBlockReason: string | null;
  coverageMode: ReviewCoverageMode | null;
  coverageSummary: string | null;
  coverage: ReviewCoverageDto | null;
  timings: ReviewTimingDto | null;
  timingSummary: string | null;
  pullRequestUrl: string;
  error: string | null;
  llmError: string | null;
  llmSummary: string | null;
  llmMetadata: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  publishedAt: string | null;
  delta: ReviewDeltaDto | null;
  publishedPreviewIds: string[];
  lastPublication: ReviewPublicationSummaryDto | null;
  files: ChangedFileDto[];
  findings: ReviewFindingDto[];
  commentCandidates: ReviewCommentCandidateDto[];
  commentPreviews: ReviewCommentPreviewDto[];
  publications: ReviewPublicationSummaryDto[];
  showVerboseLlmDebug: boolean;
};
