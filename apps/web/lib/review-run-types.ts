export type DashboardRunDto = {
  id: string;
  repoId: string;
  prNumber: number;
  headSha: string;
  title: string | null;
  status: string;
  llmStatus: string;
  publishState: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    files: number;
    findings: number;
    commentCandidates: number;
    commentPreviews: number;
  };
};

export type DashboardRunsSnapshot = {
  runs: DashboardRunDto[];
  latestRun: DashboardRunDto | null;
  summary: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    totalFindings: number;
    publishReadyRuns: number;
    llmAugmentedRuns: number;
  };
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

export type ReviewPublicationDto = {
  id: string;
  githubReviewId: string | null;
  status: string;
  requestKey: string | null;
  body: string | null;
  submittedAt: string | null;
  error: string | null;
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
  error: string | null;
  llmError: string | null;
  llmSummary: string | null;
  llmMetadata: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  publishedAt: string | null;
  files: ChangedFileDto[];
  findings: ReviewFindingDto[];
  commentCandidates: ReviewCommentCandidateDto[];
  commentPreviews: ReviewCommentPreviewDto[];
  publications: ReviewPublicationDto[];
  showVerboseLlmDebug: boolean;
};
