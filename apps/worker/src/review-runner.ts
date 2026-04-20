import { setImmediate as yieldToEventLoop } from "node:timers/promises";
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
  publishReviewRunToGitHub,
} from "@repo/providers";
import {
  buildAnalysisPlan,
  buildCoverageSummary,
  createEmptyReviewRunTimings,
  type ReviewRunMetadata,
  buildCommentCandidates,
  buildGitHubReviewPreviews,
  buildLlmReviewContextBundles,
  buildLlmReviewPrompt,
  getFindingFingerprint,
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
import type { Job } from "bullmq";

type WorkerJob = Job<ReviewJob>;

function toRunMetadataJson(metadata: ReviewRunMetadata) {
  return metadata as Prisma.InputJsonValue;
}

function updateRunMetadataProgress(
  metadata: ReviewRunMetadata,
  input: Partial<ReviewRunMetadata["progress"]> & { stage: string }
): ReviewRunMetadata {
  return {
    ...metadata,
    progress: {
      stage: input.stage,
      filesFetched: input.filesFetched ?? metadata.progress?.filesFetched ?? 0,
      filesAnalyzed: input.filesAnalyzed ?? metadata.progress?.filesAnalyzed ?? 0,
      filesSkipped:
        input.filesSkipped ?? metadata.progress?.filesSkipped ?? metadata.coverage.skippedFileCount,
      totalFiles:
        input.totalFiles ??
        metadata.progress?.totalFiles ??
        metadata.coverage.analyzableFileCount,
    },
  };
}

async function pushJobProgress(
  job: WorkerJob | undefined,
  reviewRunId: string,
  metadata: ReviewRunMetadata
) {
  if (!job) return;

  await job.updateProgress({
    reviewRunId,
    coverageMode: metadata.coverage.mode,
    filesFetched: metadata.progress?.filesFetched ?? 0,
    filesAnalyzed: metadata.progress?.filesAnalyzed ?? 0,
    filesSkipped: metadata.progress?.filesSkipped ?? metadata.coverage.skippedFileCount,
    totalFiles: metadata.progress?.totalFiles ?? metadata.coverage.analyzableFileCount,
    stage: metadata.progress?.stage ?? "queued",
    timings: metadata.timings,
  });
}

async function updateRun(reviewRunId: string, data: Record<string, unknown>) {
  await prisma.reviewRun.update({
    where: { id: reviewRunId },
    data,
  });
  await emitAfterRunUpdate(reviewRunId);
}

async function setStage(
  reviewRunId: string,
  stage: ReviewRunStage,
  metadata?: ReviewRunMetadata
) {
  await updateRun(reviewRunId, {
    status: stage,
    ...(metadata ? { runMetadata: toRunMetadataJson(metadata) } : {}),
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

async function maybeAutoPublishReviewRun(input: {
  reviewRunId: string;
  runMetadata: ReviewRunMetadata;
  startedAtMs: number;
}) {
  const config = getAppConfig();
  const finalizedMetadata: ReviewRunMetadata = {
    ...input.runMetadata,
    timings: {
      ...input.runMetadata.timings,
      totalMs: Date.now() - input.startedAtMs,
    },
  };

  if (!config.reviewRail.autoPublish) {
    await updateRun(input.reviewRunId, {
      runMetadata: toRunMetadataJson(finalizedMetadata),
    });
    return finalizedMetadata;
  }

  const publishStartedAt = Date.now();

  try {
    const result = await publishReviewRunToGitHub({
      reviewRunId: input.reviewRunId,
      trigger: "auto",
    });
    const publishMs = Date.now() - publishStartedAt;
    const nextMetadata: ReviewRunMetadata = {
      ...finalizedMetadata,
      timings: {
        ...finalizedMetadata.timings,
        publishMs,
        totalMs: Date.now() - input.startedAtMs,
      },
      progress: {
        ...(finalizedMetadata.progress ?? {
          stage: "publishing",
          filesFetched: 0,
          filesAnalyzed: 0,
          filesSkipped: finalizedMetadata.coverage.skippedFileCount,
          totalFiles: finalizedMetadata.coverage.analyzableFileCount,
        }),
        stage: "publishing",
      },
    };

    await updateRun(input.reviewRunId, {
      runMetadata: toRunMetadataJson(nextMetadata),
    });

    if (result.ok && !result.skipped) {
      logEvent("worker.review-run", "info", "Auto-published GitHub review", {
        reviewRunId: input.reviewRunId,
        event: result.event,
        commentsPublished: result.commentsPublished,
        reviewOutcome: result.reviewOutcome,
        coverageMode: nextMetadata.coverage.mode,
      });
      return nextMetadata;
    }

    if (result.ok && result.skipped) {
      logEvent("worker.review-run", "info", "Auto-publish skipped", {
        reviewRunId: input.reviewRunId,
        reason: result.reason,
        coverageMode: nextMetadata.coverage.mode,
      });
      return nextMetadata;
    }

    logEvent("worker.review-run", "warn", "Auto-publish failed", {
      reviewRunId: input.reviewRunId,
      error: result.error,
      status: result.status,
    });
    return nextMetadata;
  } catch (error) {
    logEvent("worker.review-run", "error", "Auto-publish threw unexpectedly", {
      reviewRunId: input.reviewRunId,
      error: error instanceof Error ? error.message : "Unknown publish error",
    });
    return finalizedMetadata;
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
  runMetadata: ReviewRunMetadata;
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
                finding.fingerprint ??
                getFindingFingerprint({
                  path: finding.path,
                  lineStart: finding.lineStart,
                  ruleId: finding.ruleId ?? null,
                  title: finding.title,
                  explanation: finding.explanation,
                }),
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
        runMetadata: toRunMetadataJson(input.runMetadata),
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

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

async function fetchAnalysisInputs(
  input: {
    job: ReviewJob;
    headSha: string;
    filesToAnalyze: Array<{ path: string }>;
    batchSize: number;
  },
  onBatchComplete?: (filesFetched: number) => Promise<void>
) {
  const fileContents: Array<{
    path: string;
    content: string;
  }> = [];

  for (const batch of chunkArray(input.filesToAnalyze, input.batchSize)) {
    const batchContents = await Promise.all(
      batch.map(async (file) => {
        const content = await fetchRepositoryFileContent({
          installationId: input.job.installationId,
          owner: input.job.owner,
          repo: input.job.repo,
          path: file.path,
          ref: input.headSha,
        });

        return content
          ? {
              path: file.path,
              content,
            }
          : null;
      })
    );

    fileContents.push(
      ...(batchContents.filter(Boolean) as Array<{
        path: string;
        content: string;
      }>)
    );

    if (onBatchComplete) {
      await onBatchComplete(fileContents.length);
    }

    await yieldToEventLoop();
  }

  return fileContents;
}

async function runDeterministicAnalysisBatches(
  analysisInputs: Array<{ path: string; content: string }>,
  batchSize: number,
  onBatchComplete?: (filesAnalyzed: number) => Promise<void>
) {
  const biomeFindings: Awaited<ReturnType<typeof runBiomeAnalysis>> = [];
  const semgrepFindings: Awaited<ReturnType<typeof runSemgrepAnalysis>> = [];
  let biomeMs = 0;
  let semgrepMs = 0;
  let filesAnalyzed = 0;

  for (const batch of chunkArray(analysisInputs, batchSize)) {
    const biomeStartedAt = Date.now();
    const batchBiomeFindings = await runBiomeAnalysis(batch);
    biomeMs += Date.now() - biomeStartedAt;

    const semgrepStartedAt = Date.now();
    const batchSemgrepFindings = await runSemgrepAnalysis(batch);
    semgrepMs += Date.now() - semgrepStartedAt;

    biomeFindings.push(...batchBiomeFindings);
    semgrepFindings.push(...batchSemgrepFindings);
    filesAnalyzed += batch.length;

    if (onBatchComplete) {
      await onBatchComplete(filesAnalyzed);
    }

    await yieldToEventLoop();
  }

  return {
    biomeFindings,
    semgrepFindings,
    biomeMs,
    semgrepMs,
  };
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

export async function runReviewJob(job: ReviewJob, jobRecord?: WorkerJob) {
  const loggerScope = "worker.review-run";
  const config = getAppConfig();
  const startedAtMs = Date.now();
  let runMetadata: ReviewRunMetadata = {
    coverage: {
      mode: "full",
      analyzableFileCount: 0,
      analyzedFileCount: 0,
      skippedFileCount: 0,
      skippedPaths: [],
      reason: null,
    },
    timings: createEmptyReviewRunTimings(),
    progress: {
      stage: "fetching",
      filesFetched: 0,
      filesAnalyzed: 0,
      filesSkipped: 0,
      totalFiles: 0,
    },
  };

  await setStage(job.reviewRunId, "fetching", runMetadata);
  await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);
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

  const analysisPlan = buildAnalysisPlan(snapshot.files, {
    maxAnalyzedFiles: config.reviewRail.analysis.maxAnalyzedFiles,
    maxChangedLines: config.reviewRail.analysis.maxChangedLines,
  });
  let coverageSummary = buildCoverageSummary(analysisPlan.coverage);

  runMetadata = {
    coverage: analysisPlan.coverage,
    timings: createEmptyReviewRunTimings(),
    progress: {
      stage: "fetching",
      filesFetched: 0,
      filesAnalyzed: 0,
      filesSkipped: analysisPlan.coverage.skippedFileCount,
      totalFiles: analysisPlan.coverage.analyzableFileCount,
    },
  };

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
        runMetadata: toRunMetadataJson(runMetadata),
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
  await emitAfterRunUpdate(job.reviewRunId);
  await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);

  logEvent(loggerScope, "info", "Prepared analysis plan", {
    reviewRunId: job.reviewRunId,
    coverageMode: runMetadata.coverage.mode,
    analyzableFileCount: runMetadata.coverage.analyzableFileCount,
    analyzedFileCount: runMetadata.coverage.analyzedFileCount,
    skippedFileCount: runMetadata.coverage.skippedFileCount,
    coverageReason: runMetadata.coverage.reason,
    coverageSummary,
  });

  const analysisBatchSize = Math.max(1, config.reviewRail.analysis.batchSize);
  const fetchStartedAt = Date.now();
  const analysisInputs = await fetchAnalysisInputs(
    {
      job,
      headSha: snapshot.headSha,
      filesToAnalyze: analysisPlan.filesToAnalyze,
      batchSize: analysisBatchSize,
    },
    async (filesFetched) => {
      runMetadata = updateRunMetadataProgress(runMetadata, {
        stage: "fetching",
        filesFetched,
      });
      await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);
      logEvent(loggerScope, "info", "Fetched analysis batch", {
        reviewRunId: job.reviewRunId,
        filesFetched,
        filesSkipped: runMetadata.coverage.skippedFileCount,
      });
    }
  );
  const fetchedPathSet = new Set(analysisInputs.map((input) => input.path));
  const missingFetchedPaths = analysisPlan.filesToAnalyze
    .map((file) => file.path)
    .filter((path) => !fetchedPathSet.has(path));

  runMetadata = updateRunMetadataProgress(runMetadata, {
    stage: "fetching",
    filesFetched: analysisInputs.length,
  });
  runMetadata = {
    ...runMetadata,
    coverage: {
      ...runMetadata.coverage,
      analyzedFileCount: analysisInputs.length,
      skippedFileCount:
        analysisPlan.coverage.skippedFileCount + missingFetchedPaths.length,
      skippedPaths: [
        ...analysisPlan.coverage.skippedPaths,
        ...missingFetchedPaths,
      ],
      mode:
        analysisPlan.coverage.skippedFileCount + missingFetchedPaths.length > 0
          ? "partial"
          : "full",
    },
    timings: {
      ...runMetadata.timings,
      fetchMs: Date.now() - fetchStartedAt,
    },
  };
  coverageSummary = buildCoverageSummary(runMetadata.coverage);

  runMetadata = updateRunMetadataProgress(runMetadata, {
    stage: "analyzing",
    filesFetched: analysisInputs.length,
  });
  await setStage(job.reviewRunId, "analyzing", runMetadata);
  await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);

  const {
    biomeFindings,
    semgrepFindings,
    biomeMs,
    semgrepMs,
  } = await runDeterministicAnalysisBatches(
    analysisInputs,
    analysisBatchSize,
    async (filesAnalyzed) => {
      runMetadata = updateRunMetadataProgress(runMetadata, {
        stage: "analyzing",
        filesFetched: analysisInputs.length,
        filesAnalyzed,
      });
      await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);
      logEvent(loggerScope, "info", "Analyzed file batch", {
        reviewRunId: job.reviewRunId,
        filesAnalyzed,
        totalFiles: runMetadata.coverage.analyzableFileCount,
      });
    }
  );
  const postprocessStartedAt = Date.now();
  const deterministicFindings = processFindings([...biomeFindings, ...semgrepFindings]);

  runMetadata = updateRunMetadataProgress(runMetadata, {
    stage: "postprocessing",
    filesFetched: analysisInputs.length,
    filesAnalyzed: analysisInputs.length,
  });
  runMetadata = {
    ...runMetadata,
    timings: {
      ...runMetadata.timings,
      biomeMs,
      semgrepMs,
    },
  };
  await setStage(job.reviewRunId, "postprocessing", runMetadata);
  await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);

  const deterministicArtifacts = buildArtifacts({
    reviewRunId: job.reviewRunId,
    findings: deterministicFindings,
    snapshotFiles: snapshot.files.map((file) => ({
      path: file.path,
      patch: file.patch,
    })),
    headSha: snapshot.headSha,
  });
  runMetadata = {
    ...runMetadata,
    timings: {
      ...runMetadata.timings,
      postprocessMs: Date.now() - postprocessStartedAt,
    },
  };
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
    runMetadata,
  });

  if (!config.llm.enabled) {
    runMetadata = updateRunMetadataProgress(runMetadata, {
      stage: "publishing",
      filesFetched: analysisInputs.length,
      filesAnalyzed: analysisInputs.length,
    });
    await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);
    runMetadata = await maybeAutoPublishReviewRun({
      reviewRunId: job.reviewRunId,
      runMetadata,
      startedAtMs,
    });
    logEvent(loggerScope, "info", "Completed deterministic review run", {
      reviewRunId: job.reviewRunId,
      findings: deterministicFindings.length,
      coverageMode: runMetadata.coverage.mode,
      coverageSummary,
    });
    return;
  }

  if (bundles.length === 0) {
    runMetadata = updateRunMetadataProgress(runMetadata, {
      stage: "publishing",
      filesFetched: analysisInputs.length,
      filesAnalyzed: analysisInputs.length,
    });
    await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);
    await maybeAutoPublishReviewRun({
      reviewRunId: job.reviewRunId,
      runMetadata,
      startedAtMs,
    });
    return;
  }

  try {
    const llmFindings: Array<ReturnType<typeof mergeLlmFindings>["findings"][number]> = [];
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

      await yieldToEventLoop();
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
      runMetadata,
    });
    runMetadata = updateRunMetadataProgress(runMetadata, {
      stage: "publishing",
      filesFetched: analysisInputs.length,
      filesAnalyzed: analysisInputs.length,
    });
    await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);
    runMetadata = await maybeAutoPublishReviewRun({
      reviewRunId: job.reviewRunId,
      runMetadata,
      startedAtMs,
    });

    logEvent(loggerScope, "info", "Completed LLM review augmentation", {
      reviewRunId: job.reviewRunId,
      deterministicFindings: deterministicFindings.length,
      llmFindings: llmFindings.length,
      coverageMode: runMetadata.coverage.mode,
      coverageSummary,
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
      runMetadata: toRunMetadataJson({
        ...runMetadata,
        timings: {
          ...runMetadata.timings,
          totalMs: Date.now() - startedAtMs,
        },
      }),
    });
    await pruneTerminalRuns(job.repoId, deterministicArtifacts.status);
    runMetadata = updateRunMetadataProgress(runMetadata, {
      stage: "publishing",
      filesFetched: analysisInputs.length,
      filesAnalyzed: analysisInputs.length,
    });
    await pushJobProgress(jobRecord, job.reviewRunId, runMetadata);
    await maybeAutoPublishReviewRun({
      reviewRunId: job.reviewRunId,
      runMetadata,
      startedAtMs,
    });

    logEvent(loggerScope, "warn", "LLM augmentation failed; deterministic review preserved", {
      reviewRunId: job.reviewRunId,
      error: llmError,
      coverageMode: runMetadata.coverage.mode,
      coverageSummary,
    });
  }
}
