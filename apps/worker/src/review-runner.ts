import { Prisma, prisma, pruneReviewRunHistory } from "@repo/db";
import { emitAfterRunUpdate } from "@repo/queue";
import {
  runBiomeAnalysis,
  runSemgrepAnalysis,
} from "@repo/analysis";
import {
  fetchPullRequestSnapshot,
  fetchRepositoryFileContent,
  generateOllamaReview,
} from "@repo/providers";
import {
  buildCommentCandidates,
  buildGitHubReviewPreviews,
  buildLlmReviewContextBundles,
  buildLlmReviewPrompt,
  type LlmReviewDiagnostics,
  buildReviewSummary,
  mergeLlmFindings,
  parseLlmReviewResponse,
  processFindings,
  selectPublishableReviewComments,
} from "@repo/review";
import {
  getAppConfig,
  logEvent,
  type LlmReviewStatus,
  type ReviewJob,
  type ReviewRunStage,
  terminalReviewRunStages,
} from "@repo/shared";

const ANALYZABLE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];

function isAnalyzableFile(path: string, status: string) {
  return (
    status !== "removed" &&
    ANALYZABLE_EXTENSIONS.some((extension) => path.endsWith(extension))
  );
}

async function updateRun(reviewRunId: string, data: Record<string, unknown>) {
  await prisma.reviewRun.update({
    where: { id: reviewRunId },
    data,
  });
  await emitAfterRunUpdate(reviewRunId);
}

async function setStage(reviewRunId: string, stage: ReviewRunStage) {
  await updateRun(reviewRunId, {
    status: stage,
    ...(stage === "fetching"
      ? { startedAt: new Date() }
      : {}),
  });
}

async function pruneTerminalRuns(repoId: string, status: ReviewRunStage) {
  if (!terminalReviewRunStages.has(status)) {
    return;
  }

  try {
    const removed = await pruneReviewRunHistory(repoId);

    if (removed > 0) {
      logEvent("worker.review-run", "info", "Pruned old terminal review runs", {
        repoId,
        removed,
        keepLatest: 12,
      });
    }
  } catch (error) {
    logEvent("worker.review-run", "warn", "Failed to prune old review runs", {
      repoId,
      error: error instanceof Error ? error.message : "Unknown prune error",
    });
  }
}

async function persistArtifacts(input: {
  reviewRunId: string;
  repoId: string;
  findings: Awaited<ReturnType<typeof processFindings>>;
  summary: string;
  commentCandidates: ReturnType<typeof buildCommentCandidates>;
  commentPreviews: ReturnType<typeof buildGitHubReviewPreviews>;
  status: ReviewRunStage;
  llmStatus: LlmReviewStatus;
  llmSummary?: string | null;
  llmError?: string | null;
  llmMetadata?: Record<string, unknown> | null;
}) {
  const toJson = (value: Record<string, unknown> | null | undefined) =>
    value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

  await prisma.$transaction([
    prisma.reviewFinding.deleteMany({
      where: { reviewRunId: input.reviewRunId },
    }),
    prisma.reviewCommentCandidate.deleteMany({
      where: { reviewRunId: input.reviewRunId },
    }),
    prisma.reviewCommentPreview.deleteMany({
      where: { reviewRunId: input.reviewRunId },
    }),
    ...(input.findings.length > 0
      ? [
          prisma.reviewFinding.createMany({
            data: input.findings.map((finding) => ({
              reviewRunId: input.reviewRunId,
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
              origin: finding.origin ?? "deterministic",
              ruleId: finding.ruleId ?? null,
              fingerprint:
                typeof finding.metadata?.fingerprint === "string"
                  ? finding.metadata.fingerprint
                  : null,
              publish: false,
              publishReason:
                typeof finding.metadata?.publishReason === "string"
                  ? finding.metadata.publishReason
                  : null,
              suppressionReason:
                typeof finding.metadata?.suppressionReason === "string"
                  ? finding.metadata.suppressionReason
                  : null,
              metadata: toJson(finding.metadata),
            })),
          }),
        ]
      : []),
    ...(input.commentCandidates.length > 0
      ? [
          prisma.reviewCommentCandidate.createMany({
            data: input.commentCandidates.map((candidate) => ({
              reviewRunId: input.reviewRunId,
              findingId: candidate.findingId ?? null,
              findingFingerprint: candidate.findingFingerprint ?? null,
              path: candidate.path,
              lineStart: candidate.lineStart,
              lineEnd: candidate.lineEnd ?? null,
              body: candidate.body,
              severity: candidate.severity,
              source: candidate.source,
              isPublishable: candidate.isPublishable,
              reason: candidate.reason,
              metadata: toJson(candidate.metadata),
            })),
          }),
        ]
      : []),
    ...(input.commentPreviews.length > 0
      ? [
          prisma.reviewCommentPreview.createMany({
            data: input.commentPreviews.map((preview) => ({
              reviewRunId: input.reviewRunId,
              candidateId: preview.candidateId ?? null,
              path: preview.path,
              body: preview.body,
              line: preview.line,
              side: preview.side,
              startLine: preview.startLine,
              startSide: preview.startSide,
              commitId: preview.commitId,
              isValid: preview.isValid,
              skipReason: preview.skipReason,
              payloadJson:
                preview.payloadJson == null
                  ? Prisma.JsonNull
                  : (preview.payloadJson as Prisma.InputJsonValue),
              metadata: toJson(preview.metadata),
            })),
          }),
        ]
      : []),
    prisma.reviewRun.update({
      where: { id: input.reviewRunId },
      data: {
        status: input.status,
        summary: input.summary,
        llmStatus: input.llmStatus,
        llmSummary: input.llmSummary ?? null,
        llmError: input.llmError ?? null,
        llmMetadata: toJson(input.llmMetadata),
        completedAt:
          input.status === "publish_ready" || input.status === "completed"
            ? new Date()
            : null,
      },
    }),
  ]);

  await emitAfterRunUpdate(input.reviewRunId);
  await pruneTerminalRuns(input.repoId, input.status);
}

async function fetchAnalysisInputs(job: ReviewJob, headSha: string, snapshotFiles: Array<{ path: string; status: string }>) {
  const analyzableFiles = snapshotFiles.filter((file) =>
    isAnalyzableFile(file.path, file.status)
  );

  const fileContents = await Promise.all(
    analyzableFiles.map(async (file) => {
      const content = await fetchRepositoryFileContent({
        installationId: job.installationId,
        owner: job.owner,
        repo: job.repo,
        path: file.path,
        ref: headSha,
      });

      return content
        ? {
            path: file.path,
            content,
          }
        : null;
    })
  );

  return fileContents.filter(Boolean) as Array<{
    path: string;
    content: string;
  }>;
}

function buildArtifacts(input: {
  reviewRunId: string;
  findings: Awaited<ReturnType<typeof processFindings>>;
  snapshotFiles: Array<{
    path: string;
    patch: string | null;
  }>;
  headSha: string;
}) {
  const commentCandidates = buildCommentCandidates(input.findings);
  const previewInputs = commentCandidates.map((candidate, index) => ({
    ...candidate,
    id: `${input.reviewRunId}-candidate-${index}`,
  }));
  const commentPreviews = buildGitHubReviewPreviews({
    candidates: previewInputs,
    changedFiles: input.snapshotFiles,
    headSha: input.headSha,
  });
  const summary = buildReviewSummary(input.findings);
  const publishableComments = selectPublishableReviewComments(commentPreviews);

  return {
    commentCandidates,
    commentPreviews,
    summary,
    status: publishableComments.length > 0 ? "publish_ready" : "completed",
  } as const;
}

export async function runReviewJob(job: ReviewJob) {
  const loggerScope = "worker.review-run";
  const config = getAppConfig();

  await setStage(job.reviewRunId, "fetching");
  logEvent(loggerScope, "info", "Starting review run", {
    reviewRunId: job.reviewRunId,
    repoId: job.repoId,
    prNumber: job.prNumber,
    headSha: job.headSha,
  });

  const snapshot = await fetchPullRequestSnapshot({
    installationId: job.installationId,
    owner: job.owner,
    repo: job.repo,
    prNumber: job.prNumber,
  });

  await prisma.$transaction([
    prisma.changedFile.deleteMany({
      where: { reviewRunId: job.reviewRunId },
    }),
    prisma.reviewRun.update({
      where: { id: job.reviewRunId },
      data: {
        title: snapshot.title,
        baseSha: snapshot.baseSha,
        headSha: snapshot.headSha,
        error: null,
      },
    }),
    prisma.changedFile.createMany({
      data: snapshot.files.map((file) => ({
        reviewRunId: job.reviewRunId,
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
      })),
    }),
  ]);

  await setStage(job.reviewRunId, "analyzing");

  const analysisInputs = await fetchAnalysisInputs(job, snapshot.headSha, snapshot.files);
  const [biomeFindings, semgrepFindings] = await Promise.all([
    runBiomeAnalysis(analysisInputs),
    runSemgrepAnalysis(analysisInputs),
  ]);
  const deterministicFindings = processFindings([
    ...biomeFindings,
    ...semgrepFindings,
  ]);

  await setStage(job.reviewRunId, "postprocessing");

  const deterministicArtifacts = buildArtifacts({
    reviewRunId: job.reviewRunId,
    findings: deterministicFindings,
    snapshotFiles: snapshot.files.map((file) => ({
      path: file.path,
      patch: file.patch,
    })),
    headSha: snapshot.headSha,
  });
  const bundles = config.llm.enabled
    ? buildLlmReviewContextBundles({
        changedFiles: snapshot.files,
        fileContents: analysisInputs,
        deterministicFindings,
      })
    : [];

  let llmStatus: LlmReviewStatus = config.llm.enabled
    ? bundles.length > 0
      ? "running"
      : "skipped"
    : "disabled";
  let llmSummary: string | null = null;
  let llmError: string | null = null;
  let llmMetadata: Record<string, unknown> | null = config.llm.enabled
    ? {
        enabled: true,
        bundleCount: bundles.length,
        rawFindingCount: 0,
        invalidShapeCount: 0,
        parsedFindingCount: 0,
        belowConfidenceCount: 0,
        overlappingCount: 0,
        dedupedCount: 0,
        acceptedFindingCount: 0,
        parseErrors: [],
        bundles: [],
      }
    : {
        enabled: false,
      };

  if (config.llm.enabled && bundles.length === 0) {
    llmSummary =
      "LLM review skipped because no high-signal snippets met the context budget.";
    llmMetadata = {
      ...(llmMetadata ?? {}),
      skipReason: "no_context_bundles",
    };
  }

  await persistArtifacts({
    reviewRunId: job.reviewRunId,
    repoId: job.repoId,
    findings: deterministicFindings,
    summary: deterministicArtifacts.summary,
    commentCandidates: deterministicArtifacts.commentCandidates,
    commentPreviews: deterministicArtifacts.commentPreviews,
    status:
      config.llm.enabled && bundles.length > 0
        ? "llm_pending"
        : deterministicArtifacts.status,
    llmStatus,
    llmSummary,
    llmMetadata,
  });

  if (!config.llm.enabled) {
    logEvent(loggerScope, "info", "Completed deterministic review run", {
      reviewRunId: job.reviewRunId,
      findings: deterministicFindings.length,
    });
    return;
  }

  if (bundles.length === 0) {
    return;
  }

  try {
    const llmFindings = [];
    const aggregateDiagnostics: LlmReviewDiagnostics = {
      rawFindingCount: 0,
      invalidShapeCount: 0,
      parsedFindingCount: 0,
      belowConfidenceCount: 0,
      overlappingCount: 0,
      dedupedCount: 0,
      acceptedFindingCount: 0,
      parseErrors: [],
    };
    const bundleDiagnostics: Array<Record<string, unknown>> = [];

    for (const bundle of bundles) {
      const completion = await generateOllamaReview({
        prompt: buildLlmReviewPrompt(bundle),
      });
      const parsed = parseLlmReviewResponse(completion.output);

      llmSummary = parsed.summary ?? llmSummary;
      const merged = mergeLlmFindings({
        parsed,
        deterministicFindings,
      });

      llmFindings.push(...merged.findings);
      aggregateDiagnostics.rawFindingCount += merged.diagnostics.rawFindingCount;
      aggregateDiagnostics.invalidShapeCount += merged.diagnostics.invalidShapeCount;
      aggregateDiagnostics.parsedFindingCount += merged.diagnostics.parsedFindingCount;
      aggregateDiagnostics.belowConfidenceCount += merged.diagnostics.belowConfidenceCount;
      aggregateDiagnostics.overlappingCount += merged.diagnostics.overlappingCount;
      aggregateDiagnostics.dedupedCount += merged.diagnostics.dedupedCount;
      aggregateDiagnostics.acceptedFindingCount += merged.diagnostics.acceptedFindingCount;
      aggregateDiagnostics.parseErrors?.push(
        ...(merged.diagnostics.parseErrors ?? [])
      );
      bundleDiagnostics.push({
        path: bundle.path,
        rawResponsePreview: completion.output.slice(0, 1200),
        rawFindingCount: merged.diagnostics.rawFindingCount,
        parsedFindingCount: merged.diagnostics.parsedFindingCount,
        acceptedFindingCount: merged.diagnostics.acceptedFindingCount,
        invalidShapeCount: merged.diagnostics.invalidShapeCount,
        belowConfidenceCount: merged.diagnostics.belowConfidenceCount,
        overlappingCount: merged.diagnostics.overlappingCount,
        parseErrors: merged.diagnostics.parseErrors ?? [],
      });
    }

    const combinedFindings = processFindings([
      ...deterministicFindings,
      ...llmFindings,
    ]);
    const combinedArtifacts = buildArtifacts({
      reviewRunId: job.reviewRunId,
      findings: combinedFindings,
      snapshotFiles: snapshot.files.map((file) => ({
        path: file.path,
        patch: file.patch,
      })),
      headSha: snapshot.headSha,
    });

    llmStatus = llmFindings.length > 0 ? "completed" : "skipped";
    llmMetadata = {
      enabled: true,
      bundleCount: bundles.length,
      ...aggregateDiagnostics,
      parseErrors: aggregateDiagnostics.parseErrors ?? [],
      bundles: bundleDiagnostics,
      outcome: llmFindings.length > 0 ? "accepted_findings" : "no_accepted_findings",
    };

    await persistArtifacts({
      reviewRunId: job.reviewRunId,
      repoId: job.repoId,
      findings: combinedFindings,
      summary: combinedArtifacts.summary,
      commentCandidates: combinedArtifacts.commentCandidates,
      commentPreviews: combinedArtifacts.commentPreviews,
      status: combinedArtifacts.status,
      llmStatus,
      llmSummary:
        llmSummary ??
        (llmFindings.length > 0
          ? `Ollama added ${llmFindings.length} high-confidence review findings.`
          : `Ollama returned no additional high-confidence findings. Raw candidates: ${aggregateDiagnostics.rawFindingCount}, parsed: ${aggregateDiagnostics.parsedFindingCount}, low confidence: ${aggregateDiagnostics.belowConfidenceCount}, overlapping: ${aggregateDiagnostics.overlappingCount}, invalid shape: ${aggregateDiagnostics.invalidShapeCount}.`),
      llmError: null,
      llmMetadata,
    });

    logEvent(loggerScope, "info", "Completed LLM review augmentation", {
      reviewRunId: job.reviewRunId,
      deterministicFindings: deterministicFindings.length,
      llmFindings: llmFindings.length,
      ...(llmMetadata ?? {}),
    });
  } catch (error) {
    llmStatus = "failed";
    llmError = error instanceof Error ? error.message : "Unknown LLM error";

    await updateRun(job.reviewRunId, {
      status: deterministicArtifacts.status,
      llmStatus,
      llmError,
      llmMetadata: {
        enabled: true,
        bundleCount: bundles.length,
        outcome: "failed",
      } as Prisma.InputJsonValue,
    });
    await pruneTerminalRuns(job.repoId, deterministicArtifacts.status);

    logEvent(loggerScope, "warn", "LLM augmentation failed; deterministic review preserved", {
      reviewRunId: job.reviewRunId,
      error: llmError,
    });
  }
}
