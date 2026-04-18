import { getFindingFingerprint } from "./postprocess";

export type ReviewRailEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
export type ReviewRailOutcome =
  | "running"
  | "blocking"
  | "comment_only"
  | "clean"
  | "failed";

type PreviewRecord = {
  id?: string;
  path: string;
  body: string;
  line: number | null;
  side: string | null;
  startLine: number | null;
  startSide: string | null;
  isValid: boolean;
  skipReason: string | null;
  metadata?: unknown;
};

type FindingRecord = {
  id?: string;
  fingerprint?: string | null;
  path: string;
  lineStart: number;
  ruleId?: string | null;
  title: string;
  explanation: string;
  severity: string;
  source: string;
};

type CommentCandidateRecord = {
  id?: string;
  findingId?: string | null;
  findingFingerprint?: string | null;
  path: string;
  lineStart: number;
  severity: string;
  source: string;
  isPublishable: boolean;
  reason?: string | null;
  metadata?: unknown;
};

type PublicationRecord = {
  status: string;
  reviewEvent?: string | null;
};

export type ReviewFindingDelta = {
  newFindings: number;
  resolvedFindings: number;
  persistentFindings: number;
};

export type ReviewPublicationPlan = {
  reviewOutcome: ReviewRailOutcome;
  blockingReason: string | null;
  shouldPublish: boolean;
  event: ReviewRailEvent | null;
  body: string | null;
  comments: Array<{
    path: string;
    body: string;
    line: number;
    side: "RIGHT" | "LEFT";
    start_line: number | null;
    start_side: "RIGHT" | "LEFT" | null;
  }>;
  selectedPreviewIds: string[];
  decisionReason:
    | "blocking_findings"
    | "non_blocking_findings"
    | "prior_block_cleared"
    | "no_review_needed";
};

function getScore(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 0;
  }

  const score = (metadata as Record<string, unknown>).score;
  return typeof score === "number" ? score : 0;
}

function isBlockingReason(reason?: string | null) {
  return reason === "publishable_high_signal" || reason === "publishable_llm_high_confidence";
}

function countSources(findings: FindingRecord[]) {
  return findings.reduce(
    (counts, finding) => {
      if (finding.source === "ollama") {
        counts.llm += 1;
      } else {
        counts.deterministic += 1;
      }

      return counts;
    },
    { deterministic: 0, llm: 0 }
  );
}

function countSeverities(findings: FindingRecord[]) {
  return findings.reduce(
    (counts, finding) => {
      if (finding.severity === "high") counts.high += 1;
      else if (finding.severity === "medium") counts.medium += 1;
      else counts.low += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 }
  );
}

function buildMetricsTable(rows: Array<[string, string | number]>) {
  return [
    "| Metric | Value |",
    "| --- | ---: |",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
  ].join("\n");
}

function buildInlineCommentLine(totalComments: number, commentOnly = false) {
  if (totalComments > 0) {
    return `Posted ${totalComments} inline comment${totalComments === 1 ? "" : "s"} from the highest-signal findings.`;
  }

  if (commentOnly) {
    return "No inline comments were posted because the remaining findings are summary-only or could not be anchored to the diff.";
  }

  return "No inline comments were required for this review event.";
}

function buildDeltaSection(delta?: ReviewFindingDelta | null) {
  if (!delta) {
    return [];
  }

  return [
    "### Change Since Previous Run",
    `- Resolved findings: ${delta.resolvedFindings}`,
    `- New findings: ${delta.newFindings}`,
    `- Persistent findings: ${delta.persistentFindings}`,
  ];
}

function buildBlockingBody(input: {
  repoId: string;
  prNumber: number;
  summary?: string | null;
  blockingReason: string;
  findings: FindingRecord[];
  blockingCount: number;
  commentsCount: number;
  delta?: ReviewFindingDelta | null;
}) {
  const summary =
    input.summary?.trim() ||
    `Detected ${input.findings.length} findings in this pull request.`;
  const severity = countSeverities(input.findings);
  const sourceCounts = countSources(input.findings);

  return [
    "## Observer Review",
    "",
    `**Verdict:** Request changes`,
    `**PR:** ${input.repoId} #${input.prNumber}`,
    `**Reason:** ${input.blockingReason}`,
    "",
    "### Summary",
    summary,
    "",
    "### Review Snapshot",
    buildMetricsTable([
      ["Blocking findings", input.blockingCount],
      ["High severity", severity.high],
      ["Medium severity", severity.medium],
      ["Inline comments posted", input.commentsCount],
      ["Deterministic signals", sourceCounts.deterministic],
      ["Model-assisted signals", sourceCounts.llm],
    ]),
    "",
    ...buildDeltaSection(input.delta),
    ...(input.delta ? [""] : []),
    "### Next Step",
    buildInlineCommentLine(input.commentsCount),
    "Address the blocking comments first. Observer will clear its own previous block with an approval review when a later run no longer sees merge-blocking findings.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCommentBody(input: {
  repoId: string;
  prNumber: number;
  summary?: string | null;
  findings: FindingRecord[];
  commentsCount: number;
  delta?: ReviewFindingDelta | null;
}) {
  const summary =
    input.summary?.trim() ||
    `Detected ${input.findings.length} non-blocking finding${input.findings.length === 1 ? "" : "s"} in this pull request.`;
  const severity = countSeverities(input.findings);
  const sourceCounts = countSources(input.findings);

  return [
    "## Observer Review",
    "",
    `**Verdict:** Comment only`,
    `**PR:** ${input.repoId} #${input.prNumber}`,
    "**Merge impact:** Observer is not blocking this pull request.",
    "",
    "### Summary",
    summary,
    "",
    "### Review Snapshot",
    buildMetricsTable([
      ["Total findings", input.findings.length],
      ["High severity", severity.high],
      ["Medium severity", severity.medium],
      ["Inline comments posted", input.commentsCount],
      ["Deterministic signals", sourceCounts.deterministic],
      ["Model-assisted signals", sourceCounts.llm],
    ]),
    "",
    ...buildDeltaSection(input.delta),
    ...(input.delta ? [""] : []),
    "### Next Step",
    buildInlineCommentLine(input.commentsCount, true),
    "Use the GitHub comments for quick fixes. Use Observer if you need the suppressed findings, skipped anchors, or run-to-run comparison.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildApproveBody(input: {
  repoId: string;
  prNumber: number;
  summary?: string | null;
  reviewOutcome: Extract<ReviewRailOutcome, "clean" | "comment_only">;
  findings: FindingRecord[];
  delta?: ReviewFindingDelta | null;
}) {
  const reviewLine =
    input.reviewOutcome === "clean"
      ? "Observer no longer sees merge-blocking findings in this run, so this approval clears its previous block."
      : "Observer no longer sees merge-blocking findings in this run, so this approval clears its previous block. Non-blocking follow-up items remain available in the Observer workspace.";
  const summary =
    input.reviewOutcome === "clean"
      ? "No actionable findings remain for this run."
      : input.summary?.trim() ||
        `Detected ${input.findings.length} non-blocking finding${input.findings.length === 1 ? "" : "s"} in this pull request.`;
  const severity = countSeverities(input.findings);
  const sourceCounts = countSources(input.findings);

  return [
    "## Observer Review",
    "",
    `**Verdict:** Approve`,
    `**PR:** ${input.repoId} #${input.prNumber}`,
    `**Reason:** ${reviewLine}`,
    "",
    "### Summary",
    summary,
    "",
    "### Review Snapshot",
    buildMetricsTable([
      ["Remaining findings", input.findings.length],
      ["High severity", severity.high],
      ["Medium severity", severity.medium],
      ["Deterministic signals", sourceCounts.deterministic],
      ["Model-assisted signals", sourceCounts.llm],
    ]),
    "",
    ...buildDeltaSection(input.delta),
  ]
    .filter(Boolean)
    .join("\n");
}

export function selectPublishablePreviewRecords(
  previews: PreviewRecord[],
  maxComments = 5
): PreviewRecord[] {
  return previews
    .filter(
      (preview) =>
        preview.isValid &&
        preview.line != null &&
        (preview.side === "RIGHT" || preview.side === "LEFT")
    )
    .sort((a, b) => {
      const scoreA = getScore(a.metadata);
      const scoreB = getScore(b.metadata);
      return scoreB - scoreA;
    })
    .slice(0, maxComments);
}

export function selectPublishableReviewComments(
  previews: PreviewRecord[],
  maxComments = 5
): Array<{
  path: string;
  body: string;
  line: number;
  side: "RIGHT" | "LEFT";
  start_line: number | null;
  start_side: "RIGHT" | "LEFT" | null;
}> {
  return selectPublishablePreviewRecords(previews, maxComments).map((preview) => ({
    path: preview.path,
    body: preview.body,
    line: preview.line as number,
    side: preview.side as "RIGHT" | "LEFT",
    start_line: preview.startLine ?? null,
    start_side:
      preview.startSide === "RIGHT" || preview.startSide === "LEFT"
        ? preview.startSide
        : null,
  }));
}

export function getBlockingReviewCandidates(candidates: CommentCandidateRecord[]) {
  return candidates.filter(
    (candidate) => candidate.isPublishable && isBlockingReason(candidate.reason)
  );
}

export function buildMergeBlockReason(candidates: CommentCandidateRecord[]) {
  const blockingCandidates = getBlockingReviewCandidates(candidates);

  if (blockingCandidates.length === 0) {
    return null;
  }

  const highSeverity = blockingCandidates.filter(
    (candidate) => candidate.severity === "high"
  ).length;
  const semgrep = blockingCandidates.filter(
    (candidate) => candidate.source === "semgrep"
  ).length;
  const ollama = blockingCandidates.filter(
    (candidate) => candidate.source === "ollama"
  ).length;

  const severityLine =
    highSeverity > 0
      ? `${highSeverity} high-severity finding${highSeverity === 1 ? "" : "s"}`
      : `${blockingCandidates.length} high-signal finding${blockingCandidates.length === 1 ? "" : "s"}`;
  const sourceParts = [
    semgrep > 0 ? `${semgrep} from Semgrep` : null,
    ollama > 0 ? `${ollama} from Ollama` : null,
  ].filter(Boolean);
  const verb = blockingCandidates.length === 1 ? "is" : "are";

  if (sourceParts.length === 0) {
    return `${severityLine} ${verb} blocking merge.`;
  }

  return `${severityLine} ${verb} blocking merge (${sourceParts.join(", ")}).`;
}

export function deriveReviewOutcome(input: {
  status: string;
  publishState?: string;
  findings: FindingRecord[];
  commentCandidates: CommentCandidateRecord[];
}): ReviewRailOutcome {
  if (input.status === "failed" || input.publishState === "failed") {
    return "failed";
  }

  if (!["publish_ready", "completed", "stale"].includes(input.status)) {
    return "running";
  }

  if (getBlockingReviewCandidates(input.commentCandidates).length > 0) {
    return "blocking";
  }

  if (input.findings.length > 0 || input.commentCandidates.length > 0) {
    return "comment_only";
  }

  return "clean";
}

export function buildFindingDelta(input: {
  currentFindings: FindingRecord[];
  previousFindings: FindingRecord[];
}): ReviewFindingDelta {
  const currentFingerprints = new Set(
    input.currentFindings.map((finding) =>
      finding.fingerprint ??
      getFindingFingerprint({
        path: finding.path,
        lineStart: finding.lineStart,
        ruleId: finding.ruleId ?? null,
        title: finding.title,
        explanation: finding.explanation,
      })
    )
  );
  const previousFingerprints = new Set(
    input.previousFindings.map((finding) =>
      finding.fingerprint ??
      getFindingFingerprint({
        path: finding.path,
        lineStart: finding.lineStart,
        ruleId: finding.ruleId ?? null,
        title: finding.title,
        explanation: finding.explanation,
      })
    )
  );

  let newFindings = 0;
  let persistentFindings = 0;

  for (const fingerprint of currentFingerprints) {
    if (previousFingerprints.has(fingerprint)) {
      persistentFindings += 1;
    } else {
      newFindings += 1;
    }
  }

  let resolvedFindings = 0;

  for (const fingerprint of previousFingerprints) {
    if (!currentFingerprints.has(fingerprint)) {
      resolvedFindings += 1;
    }
  }

  return {
    newFindings,
    resolvedFindings,
    persistentFindings,
  };
}

export function hasBlockingReviewPublication(publications: PublicationRecord[]) {
  return publications.some(
    (publication) =>
      publication.status === "published" &&
      publication.reviewEvent === "REQUEST_CHANGES"
  );
}

export function buildReviewPublicationPlan(input: {
  repoId: string;
  prNumber: number;
  summary?: string | null;
  findings: FindingRecord[];
  commentCandidates: CommentCandidateRecord[];
  commentPreviews: PreviewRecord[];
  latestPublishedReviewEvent?: string | null;
  delta?: ReviewFindingDelta | null;
}): ReviewPublicationPlan {
  const reviewOutcome = deriveReviewOutcome({
    status: "completed",
    findings: input.findings,
    commentCandidates: input.commentCandidates,
  });
  const blockingReason = buildMergeBlockReason(input.commentCandidates);
  const selectedPreviews = selectPublishablePreviewRecords(input.commentPreviews, 5);
  const comments = selectPublishableReviewComments(input.commentPreviews, 5);
  const selectedPreviewIds = selectedPreviews.flatMap((preview) =>
    preview.id ? [preview.id] : []
  );
  const priorReviewBlocksMerge =
    input.latestPublishedReviewEvent === "REQUEST_CHANGES";

  if (reviewOutcome === "blocking") {
    return {
      reviewOutcome,
      blockingReason,
      shouldPublish: true,
      event: "REQUEST_CHANGES",
      body: buildBlockingBody({
        repoId: input.repoId,
        prNumber: input.prNumber,
        summary: input.summary,
        blockingReason: blockingReason ?? "High-signal findings are blocking merge.",
        findings: input.findings,
        blockingCount: getBlockingReviewCandidates(input.commentCandidates).length,
        commentsCount: comments.length,
        delta: input.delta,
      }),
      comments,
      selectedPreviewIds,
      decisionReason: "blocking_findings",
    };
  }

  if (priorReviewBlocksMerge && (reviewOutcome === "comment_only" || reviewOutcome === "clean")) {
    return {
      reviewOutcome,
      blockingReason,
      shouldPublish: true,
      event: "APPROVE",
      body: buildApproveBody({
        repoId: input.repoId,
        prNumber: input.prNumber,
        summary: input.summary,
        reviewOutcome,
        findings: input.findings,
        delta: input.delta,
      }),
      comments: [],
      selectedPreviewIds: [],
      decisionReason: "prior_block_cleared",
    };
  }

  if (reviewOutcome === "comment_only") {
    return {
      reviewOutcome,
      blockingReason,
      shouldPublish: true,
      event: "COMMENT",
      body: buildCommentBody({
        repoId: input.repoId,
        prNumber: input.prNumber,
        summary: input.summary,
        findings: input.findings,
        commentsCount: comments.length,
        delta: input.delta,
      }),
      comments,
      selectedPreviewIds,
      decisionReason: "non_blocking_findings",
    };
  }

  return {
    reviewOutcome,
    blockingReason,
    shouldPublish: false,
    event: null,
    body: null,
    comments: [],
    selectedPreviewIds: [],
    decisionReason: "no_review_needed",
  };
}

export function buildPublishedReviewBody(input: {
  repoId: string;
  prNumber: number;
  totalFindings: number;
  totalComments: number;
  deterministicFindings?: number;
  llmFindings?: number;
  summary?: string | null;
}) {
  const summary = input.summary?.trim()
    ? input.summary.trim()
    : `Detected ${input.totalFindings} findings in this pull request.`;
  const signalLine = `Signal mix: ${input.deterministicFindings ?? input.totalFindings} deterministic and ${input.llmFindings ?? 0} model-assisted findings.`;

  return [
    "## Observer Review",
    "",
    `**Verdict:** Comment only`,
    `**PR:** ${input.repoId} #${input.prNumber}`,
    "",
    "### Summary",
    summary,
    "",
    "### Review Snapshot",
    buildMetricsTable([
      ["Total findings", input.totalFindings],
      ["Inline comments posted", input.totalComments],
      ["Deterministic signals", input.deterministicFindings ?? input.totalFindings],
      ["Model-assisted signals", input.llmFindings ?? 0],
    ]),
    "",
    "### Next Step",
    signalLine,
    buildInlineCommentLine(input.totalComments, true),
  ].join("\n");
}
