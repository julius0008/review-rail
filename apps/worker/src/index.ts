import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@repo/db";
import { emitAfterRunUpdate, getRedisConnection, getReviewQueue } from "@repo/queue";
import { parseReviewRunMetadata } from "@repo/review";
import { getAppConfig, logEvent, reviewJobSchema } from "@repo/shared";
import { runReviewJob } from "./review-runner";

const config = getAppConfig();

const worker = new Worker(
  "review-pr",
  async (job) => {
    const parsed = reviewJobSchema.parse(job.data);
    await runReviewJob(parsed, job);
  },
  {
    connection: getRedisConnection(),
    concurrency: 1,
    lockDuration: config.reviewRail.worker.lockDurationMs,
    stalledInterval: config.reviewRail.worker.stalledIntervalMs,
    maxStalledCount: config.reviewRail.worker.maxStalledCount,
  }
);

worker.on("completed", (job) => {
  logEvent("worker.queue", "info", "Job completed", { jobId: job.id });
});

worker.on("stalled", async (jobId) => {
  const stalledJob = jobId ? await getReviewQueue().getJob(String(jobId)) : null;
  const reviewRunId = stalledJob?.data?.reviewRunId;

  if (!reviewRunId) {
    logEvent("worker.queue", "warn", "Job stalled before review run context was available", {
      jobId,
    });
    return;
  }

  const run = await prisma.reviewRun.findUnique({
    where: { id: reviewRunId },
    select: {
      id: true,
      repoId: true,
      prNumber: true,
      status: true,
      runMetadata: true,
    },
  });
  const runMetadata = parseReviewRunMetadata(run?.runMetadata);

  logEvent("worker.queue", "warn", "Job stalled", {
    jobId,
    reviewRunId,
    repoId: run?.repoId,
    prNumber: run?.prNumber,
    status: run?.status,
    stage: runMetadata?.progress?.stage ?? null,
    coverageMode: runMetadata?.coverage.mode ?? null,
    filesFetched: runMetadata?.progress?.filesFetched ?? null,
    filesAnalyzed: runMetadata?.progress?.filesAnalyzed ?? null,
    filesSkipped: runMetadata?.progress?.filesSkipped ?? null,
    timings: runMetadata?.timings ?? null,
  });
});

worker.on("failed", async (job, err) => {
  const reviewRunId = (job?.data as { reviewRunId?: string } | undefined)?.reviewRunId;
  const run = reviewRunId
    ? await prisma.reviewRun.findUnique({
        where: { id: reviewRunId },
        select: {
          id: true,
          repoId: true,
          prNumber: true,
          status: true,
          runMetadata: true,
        },
      })
    : null;
  const runMetadata = parseReviewRunMetadata(run?.runMetadata);

  logEvent("worker.queue", "error", "Job failed", {
    jobId: job?.id,
    error: err.message,
    reviewRunId,
    repoId: run?.repoId,
    prNumber: run?.prNumber,
    status: run?.status,
    stage: runMetadata?.progress?.stage ?? null,
    coverageMode: runMetadata?.coverage.mode ?? null,
    filesFetched: runMetadata?.progress?.filesFetched ?? null,
    filesAnalyzed: runMetadata?.progress?.filesAnalyzed ?? null,
    filesSkipped: runMetadata?.progress?.filesSkipped ?? null,
    timings: runMetadata?.timings ?? null,
  });

  if (!reviewRunId) return;

  await prisma.reviewRun.update({
    where: { id: reviewRunId },
    data: {
      status: "failed",
      error: err.message,
      completedAt: new Date(),
    },
  });

  await emitAfterRunUpdate(reviewRunId);
});

logEvent("worker", "info", "Worker started", {
  nodeEnv: process.env.NODE_ENV ?? "development",
  appUrl: config.appUrl,
  llmEnabled: config.llm.enabled,
  llmProvider: config.llm.provider,
  autoPublish: config.reviewRail.autoPublish,
  blockingMode: config.reviewRail.blockingMode,
});

if (config.llm.enabled) {
  logEvent("worker", "info", "LLM augmentation enabled", {
    provider: config.llm.provider,
    model: config.llm.ollama.model,
    timeoutMs: config.llm.timeoutMs,
  });
} else {
  logEvent(
    "worker",
    "info",
    "LLM augmentation disabled; deterministic analyzers remain the production baseline",
    {
      ollamaConfigIgnored: Boolean(
        process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL
      ),
    }
  );
}
