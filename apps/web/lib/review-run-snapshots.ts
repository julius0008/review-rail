import "server-only";

import { Prisma, prisma } from "@repo/db";
import { getAppConfig } from "@repo/shared";
import type {
  DashboardRunDto,
  DashboardRunsSnapshot,
  ReviewRunDetailDto,
} from "./review-run-types";

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
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

type DashboardRunRecord = Prisma.ReviewRunGetPayload<{
  include: {
    _count: {
      select: {
        files: true;
        findings: true;
        commentCandidates: true;
        commentPreviews: true;
      };
    };
  };
}>;

function serializeDashboardRun(run: DashboardRunRecord): DashboardRunDto {
  return {
    id: run.id,
    repoId: run.repoId,
    prNumber: run.prNumber,
    headSha: run.headSha,
    title: run.title,
    status: run.status,
    llmStatus: run.llmStatus,
    publishState: run.publishState,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    counts: {
      files: run._count.files,
      findings: run._count.findings,
      commentCandidates: run._count.commentCandidates,
      commentPreviews: run._count.commentPreviews,
    },
  };
}

export async function getDashboardRunsSnapshot(): Promise<DashboardRunsSnapshot> {
  const runs: DashboardRunRecord[] = await prisma.reviewRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    include: {
      _count: {
        select: {
          files: true,
          findings: true,
          commentCandidates: true,
          commentPreviews: true,
        },
      },
    },
  });

  const serializedRuns = runs.map(serializeDashboardRun);

  return {
    runs: serializedRuns,
    latestRun: serializedRuns[0] ?? null,
    summary: {
      totalRuns: serializedRuns.length,
      completedRuns: serializedRuns.filter((run) => run.status === "completed").length,
      failedRuns: serializedRuns.filter((run) => run.status === "failed").length,
      totalFindings: serializedRuns.reduce((sum, run) => sum + run.counts.findings, 0),
      publishReadyRuns: serializedRuns.filter((run) => run.status === "publish_ready").length,
      llmAugmentedRuns: serializedRuns.filter((run) => run.llmStatus === "completed").length,
    },
  };
}

export async function getReviewRunDetailSnapshot(
  reviewRunId: string
): Promise<ReviewRunDetailDto | null> {
  const config = getAppConfig();
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
    error: run.error ?? null,
    llmError: run.llmError ?? null,
    llmSummary: run.llmSummary ?? null,
    llmMetadata: sanitizeLlmMetadata(run.llmMetadata, config.debug.llmUi),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: toIsoString(run.startedAt),
    completedAt: toIsoString(run.completedAt),
    publishedAt: toIsoString(run.publishedAt),
    showVerboseLlmDebug: config.debug.llmUi,
    files: run.files.map((file) => ({
      id: file.id,
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch ?? null,
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
    publications: run.publications.map((publication) => ({
      id: publication.id,
      githubReviewId: publication.githubReviewId ?? null,
      status: publication.status,
      requestKey: publication.requestKey ?? null,
      body: publication.body ?? null,
      submittedAt: toIsoString(publication.submittedAt),
      error: publication.error ?? null,
      createdAt: publication.createdAt.toISOString(),
    })),
  };
}
