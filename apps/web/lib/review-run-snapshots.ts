import "server-only";

import { Prisma, prisma } from "@repo/db";
import {
  buildCoverageSummary,
  buildFindingDelta,
  buildMergeBlockReason,
  deriveReviewOutcome,
  parseReviewRunMetadata,
  selectPublishablePreviewRecords,
} from "@repo/review";
import { getAppConfig } from "@repo/shared";
import type {
  DashboardHistoryRunDto,
  DashboardRunsSnapshot,
  ReviewCoverageDto,
  ReviewPublicationSummaryDto,
  ReviewRunDetailDto,
  ReviewTimingDto,
} from "./review-run-types";

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function buildPullRequestUrl(repoId: string, prNumber: number) {
  return `https://github.com/${repoId}/pull/${prNumber}`;
}

function formatDuration(value: number | null | undefined) {
  if (value == null) return null;
  if (value < 1000) return `${value} ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value / 1000)} s`;
}

function buildTimingSummary(timings: ReviewTimingDto | null) {
  if (!timings) return null;

  const parts = [
    timings.totalMs != null ? `Total ${formatDuration(timings.totalMs)}` : null,
    timings.fetchMs != null ? `Fetch ${formatDuration(timings.fetchMs)}` : null,
    timings.biomeMs != null ? `Biome ${formatDuration(timings.biomeMs)}` : null,
    timings.semgrepMs != null ? `Semgrep ${formatDuration(timings.semgrepMs)}` : null,
    timings.postprocessMs != null
      ? `Postprocess ${formatDuration(timings.postprocessMs)}`
      : null,
    timings.publishMs != null ? `Publish ${formatDuration(timings.publishMs)}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function serializeCoverage(runMetadata: Prisma.JsonValue | null): ReviewCoverageDto | null {
  const parsed = parseReviewRunMetadata(runMetadata);

  if (!parsed) return null;

  return {
    ...parsed.coverage,
    summary: buildCoverageSummary(parsed.coverage),
  };
}

function serializeTimings(runMetadata: Prisma.JsonValue | null): ReviewTimingDto | null {
  const parsed = parseReviewRunMetadata(runMetadata);
  return parsed ? parsed.timings : null;
}

function sanitizeLlmMetadata(
  llmMetadata: unknown,
  showVerboseLlmDebug: boolean
) {
  if (!llmMetadata || typeof llmMetadata !== "object" || Array.isArray(llmMetadata)) {
    return llmMetadata;
  }

  if (showVerboseLlmDebug) {
    return llmMetadata;
  }

  const { bundles, parseErrors, ...safeMetadata } = llmMetadata as Record<string, unknown>;
  return safeMetadata;
}

type ReviewPublicationRecord = Prisma.ReviewPublicationGetPayload<Record<string, never>>;

function serializePublication(
  publication: ReviewPublicationRecord
): ReviewPublicationSummaryDto {
  return {
    id: publication.id,
    githubReviewId: publication.githubReviewId ?? null,
    status: publication.status,
    reviewEvent: publication.reviewEvent ?? null,
    commentsCount: publication.commentsCount,
    requestKey: publication.requestKey ?? null,
    body: publication.body ?? null,
    submittedAt: toIsoString(publication.submittedAt),
    error: publication.error ?? null,
    createdAt: publication.createdAt.toISOString(),
  };
}

type ReviewRunSnapshotRecord = Prisma.ReviewRunGetPayload<{
  include: {
    files: true;
    findings: true;
    commentCandidates: true;
    commentPreviews: true;
    publications: {
      orderBy: { createdAt: "desc" };
    };
  };
}>;

function buildRunDerivedState(
  run: Pick<
    ReviewRunSnapshotRecord,
    | "status"
    | "publishState"
    | "repoId"
    | "prNumber"
    | "findings"
    | "commentCandidates"
    | "commentPreviews"
    | "publications"
    | "runMetadata"
  >,
  previousFindings: ReviewRunSnapshotRecord["findings"] = []
) {
  const coverage = serializeCoverage(run.runMetadata);
  const reviewOutcome = deriveReviewOutcome({
    status: run.status,
    publishState: run.publishState,
    findings: run.findings,
    commentCandidates: run.commentCandidates,
    coverageMode: coverage?.mode ?? null,
  });
  const mergeBlockReason = buildMergeBlockReason(run.commentCandidates);
  const lastPublication = run.publications[0] ? serializePublication(run.publications[0]) : null;
  const delta =
    previousFindings.length > 0
      ? buildFindingDelta({
          currentFindings: run.findings,
          previousFindings,
        })
      : null;
  const publishedPreviewIds =
    lastPublication?.status === "published" &&
    (lastPublication.reviewEvent === "COMMENT" ||
      lastPublication.reviewEvent === "REQUEST_CHANGES")
      ? selectPublishablePreviewRecords(run.commentPreviews).flatMap((preview) =>
          preview.id ? [preview.id] : []
        )
      : [];

  return {
    reviewOutcome,
    mergeBlockReason,
    lastPublication,
    delta,
    publishedPreviewIds,
  };
}

function serializeReviewRun(
  run: ReviewRunSnapshotRecord,
  previousFindings: ReviewRunSnapshotRecord["findings"] = [],
  options: { includePatches?: boolean } = {}
): ReviewRunDetailDto {
  const config = getAppConfig();
  const derived = buildRunDerivedState(run, previousFindings);
  const coverage = serializeCoverage(run.runMetadata);
  const timings = serializeTimings(run.runMetadata);

  return {
    id: run.id,
    repoId: run.repoId,
    prNumber: run.prNumber,
    headSha: run.headSha,
    baseSha: run.baseSha ?? null,
    title: run.title ?? null,
    summary: run.summary ?? null,
    status: run.status,
    llmStatus: run.llmStatus,
    publishState: run.publishState,
    reviewOutcome: derived.reviewOutcome,
    mergeBlockReason: derived.mergeBlockReason,
    coverageMode: coverage?.mode ?? null,
    coverageSummary: coverage?.summary ?? null,
    coverage,
    timings,
    timingSummary: buildTimingSummary(timings),
    pullRequestUrl: buildPullRequestUrl(run.repoId, run.prNumber),
    error: run.error ?? null,
    llmError: run.llmError ?? null,
    llmSummary: run.llmSummary ?? null,
    llmMetadata: sanitizeLlmMetadata(run.llmMetadata, config.debug.llmUi),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: toIsoString(run.startedAt),
    completedAt: toIsoString(run.completedAt),
    publishedAt: toIsoString(run.publishedAt),
    delta: derived.delta,
    publishedPreviewIds: derived.publishedPreviewIds,
    lastPublication: derived.lastPublication,
    showVerboseLlmDebug: config.debug.llmUi,
    files: run.files.map((file) => ({
      id: file.id,
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: options.includePatches === false ? null : file.patch ?? null,
      createdAt: file.createdAt.toISOString(),
    })),
    findings: run.findings.map((finding) => ({
      id: finding.id,
      path: finding.path,
      lineStart: finding.lineStart,
      lineEnd: finding.lineEnd ?? null,
      category: finding.category,
      severity: finding.severity,
      confidence: finding.confidence,
      title: finding.title,
      explanation: finding.explanation,
      actionableFix: finding.actionableFix ?? null,
      source: finding.source,
      origin: finding.origin,
      ruleId: finding.ruleId ?? null,
      fingerprint: finding.fingerprint ?? null,
      publish: finding.publish,
      publishReason: finding.publishReason ?? null,
      suppressionReason: finding.suppressionReason ?? null,
      metadata: finding.metadata,
      createdAt: finding.createdAt.toISOString(),
    })),
    commentCandidates: run.commentCandidates.map((candidate) => ({
      id: candidate.id,
      findingId: candidate.findingId ?? null,
      findingFingerprint: candidate.findingFingerprint ?? null,
      path: candidate.path,
      lineStart: candidate.lineStart,
      lineEnd: candidate.lineEnd ?? null,
      body: candidate.body,
      severity: candidate.severity,
      source: candidate.source,
      isPublishable: candidate.isPublishable,
      reason: candidate.reason ?? null,
      metadata: candidate.metadata,
      createdAt: candidate.createdAt.toISOString(),
    })),
    commentPreviews: run.commentPreviews.map((preview) => ({
      id: preview.id,
      candidateId: preview.candidateId ?? null,
      path: preview.path,
      body: preview.body,
      line: preview.line ?? null,
      side: preview.side ?? null,
      startLine: preview.startLine ?? null,
      startSide: preview.startSide ?? null,
      commitId: preview.commitId ?? null,
      isValid: preview.isValid,
      skipReason: preview.skipReason ?? null,
      payloadJson: preview.payloadJson,
      metadata: preview.metadata,
      createdAt: preview.createdAt.toISOString(),
    })),
    publications: run.publications.map(serializePublication),
  };
}

type DashboardRunRecord = Prisma.ReviewRunGetPayload<{
  include: {
    findings: {
      select: {
        id: true;
      };
    };
    commentCandidates: {
      select: {
        isPublishable: true;
        reason: true;
      };
    };
    publications: {
      orderBy: { createdAt: "desc" };
      take: 1;
    };
  };
}>;

function serializeDashboardHistoryRun(run: DashboardRunRecord): DashboardHistoryRunDto {
  const coverage = serializeCoverage(run.runMetadata);
  const reviewOutcome = deriveReviewOutcome({
    status: run.status,
    publishState: run.publishState,
    findings: Array.from({ length: run.findings.length }, () => ({
      path: "",
      lineStart: 0,
      title: "",
      explanation: "",
      severity: "low",
      source: "biome",
    })),
    commentCandidates: run.commentCandidates.map((candidate) => ({
      path: "",
      lineStart: 0,
      severity: "low",
      source: "biome",
      isPublishable: candidate.isPublishable,
      reason: candidate.reason,
    })),
    coverageMode: coverage?.mode ?? null,
  });
  const blockingCount = run.commentCandidates.filter(
    (candidate) =>
      candidate.isPublishable &&
      (candidate.reason === "publishable_high_signal" ||
        candidate.reason === "publishable_llm_high_confidence")
  ).length;
  const lastPublication = run.publications[0] ? serializePublication(run.publications[0]) : null;
  const timings = serializeTimings(run.runMetadata);

  return {
    id: run.id,
    repoId: run.repoId,
    prNumber: run.prNumber,
    headSha: run.headSha,
    title: run.title ?? null,
    status: run.status,
    llmStatus: run.llmStatus,
    publishState: run.publishState,
    reviewOutcome,
    mergeBlockReason:
      blockingCount > 0
        ? `${blockingCount} high-signal finding${blockingCount === 1 ? "" : "s"} blocking merge.`
        : null,
    coverageMode: coverage?.mode ?? null,
    coverageSummary: coverage?.summary ?? null,
    coverage,
    timingSummary: buildTimingSummary(timings),
    pullRequestUrl: buildPullRequestUrl(run.repoId, run.prNumber),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    counts: {
      findings: run.findings.length,
      blockingFindings: blockingCount,
      publishedComments: lastPublication?.commentsCount ?? 0,
    },
    lastPublication,
  };
}

export async function getDashboardRunsSnapshot(): Promise<DashboardRunsSnapshot> {
  const historyRuns: DashboardRunRecord[] = await prisma.reviewRun.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10,
    include: {
      findings: {
        select: {
          id: true,
        },
      },
      commentCandidates: {
        select: {
          isPublishable: true,
          reason: true,
        },
      },
      publications: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const currentRunId = historyRuns[0]?.id ?? null;
  const currentRun = currentRunId
    ? await getReviewRunDetailSnapshot(currentRunId, {
        includePatches: false,
      })
    : null;

  return {
    currentRun,
    history: historyRuns.slice(currentRun ? 1 : 0).map(serializeDashboardHistoryRun),
  };
}

export async function getReviewRunDetailSnapshot(
  reviewRunId: string,
  options: { includePatches?: boolean } = {}
): Promise<ReviewRunDetailDto | null> {
  const run = await prisma.reviewRun.findUnique({
    where: { id: reviewRunId },
    include: {
      files: {
        orderBy: { changes: "desc" },
      },
      findings: {
        orderBy: [{ path: "asc" }, { lineStart: "asc" }],
      },
      commentCandidates: {
        orderBy: [{ isPublishable: "desc" }, { severity: "asc" }, { path: "asc" }],
      },
      commentPreviews: {
        orderBy: [{ isValid: "desc" }, { path: "asc" }],
      },
      publications: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!run) {
    return null;
  }

  const previousRun = await prisma.reviewRun.findFirst({
    where: {
      repoId: run.repoId,
      prNumber: run.prNumber,
      id: { not: run.id },
      status: { not: "stale" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      findings: {
        orderBy: [{ path: "asc" }, { lineStart: "asc" }],
      },
    },
  });

  return serializeReviewRun(run, previousRun?.findings ?? [], options);
}
